"""
FastAPI Production Backend — AI-Powered EV Fleet Optimization & Charging Infrastructure Analytics.
Run locally or on Render:
    uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
"""

from __future__ import annotations

from contextlib import asynccontextmanager
import logging
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, get_db, init_db
from app.models import (
    ChargingRecommendation,
    ChargingStation,
    HotspotCluster,
    MlModelRun,
    MlPrediction,
    Telemetry,
    Trip,
    Vehicle,
)
from app.schemas import GenerateDataRequest, LivePredictRequest, TrainModelsRequest
from app.services.optimizer import simulate_delivery_delay_impact
from ml.predict import predict_vehicle_intelligence
from scripts.seed_database import seed_database
from scripts.train_all import train_full_ml_suite

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("ev_fleet_api")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Initializing PostgreSQL schema and checking fleet baseline...")
    init_db()
    with SessionLocal() as db:
        v_count = db.query(Vehicle).count()
        if v_count == 0:
            logger.info("Empty database detected — running initial synthetic seed + ML training.")
            seed_database(db, target_records=5000, num_vehicles=60, seed=42)
            train_full_ml_suite(db, random_state=42)
        elif db.query(MlModelRun).count() == 0:
            logger.info("Training ML models on existing PostgreSQL telemetry...")
            train_full_ml_suite(db, random_state=42)
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="End-to-end EV fleet telemetry, ML range/risk/demand forecasting, K-Means hotspot clustering, and OR-Tools charging station optimization API.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=settings.cors_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check(db: Session = Depends(get_db)):
    try:
        server_time = db.execute(text("SELECT NOW()")).scalar()
        return {
            "status": "ok",
            "service": "ev-fleet-optimization-fastapi",
            "database": "connected",
            "serverTime": str(server_time),
            "counts": {
                "vehicles": db.query(Vehicle).count(),
                "telemetry": db.query(Telemetry).count(),
            },
            "storage": {
                "mode": "s3" if settings.s3_enabled else "local",
                "bucket": settings.s3_bucket_name or None,
                "region": settings.aws_region if settings.s3_enabled else None,
            },
        }
    except Exception as exc:
        logger.exception("Health check failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database unavailable: {exc}",
        ) from exc


@app.get("/api/vehicles")
def list_vehicles(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=120),
    risk: Optional[str] = Query(None),
    area: Optional[str] = Query(None),
    vehicle_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    offset = (page - 1) * limit
    clauses = []
    params: dict = {"limit": limit, "offset": offset}

    if risk and risk.upper() in ("LOW", "MEDIUM", "HIGH"):
        clauses.append("COALESCE(p.battery_risk, 'LOW') = :risk")
        params["risk"] = risk.upper()
    if area and area != "ALL":
        clauses.append("lt.area = :area")
        params["area"] = area
    if vehicle_type and vehicle_type != "ALL":
        clauses.append("v.vehicle_type = :vtype")
        params["vtype"] = vehicle_type
    if search:
        clauses.append("(v.vehicle_id ILIKE :q OR v.model_name ILIKE :q OR lt.area ILIKE :q)")
        params["q"] = f"%{search.strip()}%"

    where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    cte = """
        WITH latest_telemetry AS (
            SELECT DISTINCT ON (vehicle_id) *
            FROM telemetry
            ORDER BY vehicle_id, timestamp DESC
        )
    """
    total = db.execute(
        text(
            f"{cte} SELECT COUNT(*)::int FROM vehicles v "
            f"JOIN latest_telemetry lt ON lt.vehicle_id = v.vehicle_id "
            f"LEFT JOIN ml_predictions p ON p.vehicle_id = v.vehicle_id {where_sql}"
        ),
        params,
    ).scalar_one()

    rows = (
        db.execute(
            text(
                f"{cte} SELECT v.vehicle_id, v.fleet_code, v.model_name, v.vehicle_type, "
                f"v.battery_capacity_kwh, v.status, lt.timestamp AS last_seen, lt.latitude, "
                f"lt.longitude, lt.battery_percentage, lt.speed_kmh, lt.remaining_range_km, "
                f"lt.temperature_c, lt.traffic_level, lt.delivery_delay_minutes, "
                f"lt.nearest_station_id, lt.nearest_station_distance_km, lt.area, "
                f"COALESCE(p.predicted_range_km, lt.remaining_range_km) AS predicted_range_km, "
                f"COALESCE(p.battery_risk, 'LOW') AS battery_risk "
                f"FROM vehicles v JOIN latest_telemetry lt ON lt.vehicle_id = v.vehicle_id "
                f"LEFT JOIN ml_predictions p ON p.vehicle_id = v.vehicle_id {where_sql} "
                f"ORDER BY lt.battery_percentage ASC LIMIT :limit OFFSET :offset"
            ),
            params,
        )
        .mappings()
        .all()
    )

    return {
        "items": [dict(r) for r in rows],
        "pagination": {
            "page": page,
            "limit": limit,
            "total": total,
            "totalPages": max(1, (total + limit - 1) // limit),
        },
    }


@app.get("/api/vehicles/{vehicle_id}")
def get_vehicle(vehicle_id: str, db: Session = Depends(get_db)):
    vid = vehicle_id.strip().upper()
    vehicle = db.query(Vehicle).filter(Vehicle.vehicle_id == vid).first()
    if not vehicle:
        raise HTTPException(status_code=404, detail=f"Vehicle {vid} not found")

    history = (
        db.query(Telemetry)
        .filter(Telemetry.vehicle_id == vid)
        .order_by(Telemetry.timestamp.desc())
        .limit(30)
        .all()
    )
    pred = db.query(MlPrediction).filter(MlPrediction.vehicle_id == vid).first()
    recent_trips = (
        db.query(Trip).filter(Trip.vehicle_id == vid).order_by(Trip.start_time.desc()).limit(8).all()
    )
    return {
        "vehicle": {
            "vehicleId": vehicle.vehicle_id,
            "modelName": vehicle.model_name,
            "vehicleType": vehicle.vehicle_type,
            "batteryCapacityKwh": vehicle.battery_capacity_kwh,
            "homeArea": vehicle.home_area,
            "status": vehicle.status,
        },
        "prediction": {
            "predictedRangeKm": pred.predicted_range_km,
            "batteryRisk": pred.battery_risk,
            "riskProbability": pred.risk_probability,
            "riskProbabilities": pred.risk_probabilities,
            "rangeModelName": pred.range_model_name,
        }
        if pred
        else None,
        "telemetryCount": len(history),
        "recentTripsCount": len(recent_trips),
    }


@app.get("/api/telemetry")
def list_telemetry(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    vehicle_id: Optional[str] = Query(None),
    area: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(Telemetry)
    if vehicle_id:
        q = q.filter(Telemetry.vehicle_id == vehicle_id.upper())
    if area and area != "ALL":
        q = q.filter(Telemetry.area == area)
    total = q.count()
    items = q.order_by(Telemetry.timestamp.desc()).offset((page - 1) * limit).limit(limit).all()
    return {
        "items": [
            {
                "id": r.id,
                "vehicle_id": r.vehicle_id,
                "trip_id": r.trip_id,
                "timestamp": r.timestamp.isoformat(),
                "latitude": r.latitude,
                "longitude": r.longitude,
                "battery_percentage": r.battery_percentage,
                "speed_kmh": r.speed_kmh,
                "remaining_range_km": r.remaining_range_km,
                "temperature_c": r.temperature_c,
                "energy_consumption_kwh_per_km": r.energy_consumption_kwh_per_km,
                "traffic_level": r.traffic_level,
                "delivery_delay_minutes": r.delivery_delay_minutes,
                "nearest_station_distance_km": r.nearest_station_distance_km,
                "area": r.area,
                "cluster_id": r.cluster_id,
            }
            for r in items
        ],
        "pagination": {"page": page, "limit": limit, "total": total},
    }


@app.get("/api/fleet/summary")
def fleet_summary(db: Session = Depends(get_db)):
    row = (
        db.execute(
            text(
                """
                WITH latest AS (
                    SELECT DISTINCT ON (vehicle_id) *
                    FROM telemetry ORDER BY vehicle_id, timestamp DESC
                )
                SELECT
                    (SELECT count(*)::int FROM vehicles) AS total_evs,
                    (SELECT count(*)::int FROM vehicles WHERE status IN ('active','charging')) AS active_evs,
                    ROUND(AVG(l.battery_percentage)::numeric, 1)::float AS avg_battery_pct,
                    COUNT(*) FILTER (WHERE l.battery_percentage < 25 OR p.battery_risk = 'HIGH')::int AS critical_battery_vehicles,
                    ROUND(AVG(COALESCE(p.predicted_range_km, l.remaining_range_km))::numeric, 1)::float AS avg_remaining_range_km,
                    ROUND((SELECT AVG(delivery_delay_minutes) FROM telemetry)::numeric, 1)::float AS avg_delivery_delay_min
                FROM latest l
                LEFT JOIN ml_predictions p ON p.vehicle_id = l.vehicle_id
                """
            )
        )
        .mappings()
        .one()
    )
    return {"kpis": dict(row)}


@app.get("/api/fleet/battery-risk")
def fleet_battery_risk(db: Session = Depends(get_db)):
    run = db.query(MlModelRun).filter(MlModelRun.model_task == "battery_risk").first()
    preds = db.query(MlPrediction).all()
    return {
        "model": {
            "algorithmName": run.algorithm_name,
            "metrics": run.metrics,
            "artifactPath": run.artifact_path,
        }
        if run
        else None,
        "predictions": [
            {
                "vehicle_id": p.vehicle_id,
                "area": p.area,
                "battery_risk": p.battery_risk,
                "risk_probability": p.risk_probability,
                "predicted_range_km": p.predicted_range_km,
                "nearest_station_distance_km": p.nearest_station_distance_km,
            }
            for p in preds
        ],
    }


@app.get("/api/fleet/range-predictions")
def fleet_range_predictions(db: Session = Depends(get_db)):
    runs = db.query(MlModelRun).filter(MlModelRun.model_task == "range_prediction").all()
    preds = db.query(MlPrediction).order_by(MlPrediction.predicted_range_km.asc()).all()
    return {
        "modelComparison": [
            {
                "algorithmName": r.algorithm_name,
                "isSelected": r.is_selected,
                **r.metrics,
            }
            for r in runs
        ],
        "vehiclePredictions": [
            {
                "vehicle_id": p.vehicle_id,
                "area": p.area,
                "actual_range_km": p.actual_range_km,
                "predicted_range_km": p.predicted_range_km,
                "range_model_name": p.range_model_name,
            }
            for p in preds
        ],
    }


@app.get("/api/charging-stations")
def list_charging_stations(db: Session = Depends(get_db)):
    stations = db.query(ChargingStation).order_by(ChargingStation.station_id.asc()).all()
    return {
        "stations": [
            {
                "station_id": s.station_id,
                "name": s.name,
                "area": s.area,
                "latitude": s.latitude,
                "longitude": s.longitude,
                "total_ports": s.total_ports,
                "available_ports": s.available_ports,
                "max_power_kw": s.max_power_kw,
                "avg_utilization_pct": s.avg_utilization_pct,
                "status": s.status,
            }
            for s in stations
        ]
    }


@app.get("/api/charging-demand")
def get_charging_demand(db: Session = Depends(get_db)):
    run = db.query(MlModelRun).filter(MlModelRun.model_task == "charging_demand").first()
    if not run:
        return {"model": None, "areaForecasts": []}
    return {
        "model": {
            "algorithmName": run.algorithm_name,
            "mae": run.metrics.get("mae"),
            "rmse": run.metrics.get("rmse"),
            "r2": run.metrics.get("r2"),
        },
        "areaForecasts": run.metrics.get("areaForecasts", []),
    }


@app.get("/api/hotspots")
def get_hotspots(category: Optional[str] = Query(None), db: Session = Depends(get_db)):
    q = db.query(HotspotCluster)
    if category:
        q = q.filter(HotspotCluster.cluster_category == category.upper())
    clusters = q.order_by(HotspotCluster.severity_score.desc()).all()
    return {
        "hotspots": [
            {
                "clusterId": c.cluster_id,
                "clusterIndex": c.cluster_index,
                "clusterCategory": c.cluster_category,
                "area": c.area,
                "centroidLat": c.centroid_lat,
                "centroidLon": c.centroid_lon,
                "radiusKm": c.radius_km,
                "vehicleCount": c.vehicle_count,
                "avgBatteryPct": c.avg_battery_pct,
                "criticalEvents": c.critical_events,
                "demandIntensity": c.demand_intensity,
                "nearestStationDistanceKm": c.nearest_station_distance_km,
                "severityScore": c.severity_score,
            }
            for c in clusters
        ]
    }


def _serialize_rec(r: ChargingRecommendation) -> dict:
    return {
        "rank": r.rank,
        "latitude": r.latitude,
        "longitude": r.longitude,
        "area": r.area,
        "corridor_label": r.corridor_label,
        "score": r.score,
        "expected_ev_coverage": r.expected_ev_coverage,
        "battery_risk_reduction_pct": r.battery_risk_reduction_pct,
        "expected_delay_reduction": r.expected_delay_reduction,
        "expected_delay_reduction_pct": r.expected_delay_reduction_pct,
        "nearest_existing_station_distance": r.nearest_existing_station_distance,
        "predicted_daily_demand_kwh": r.predicted_daily_demand_kwh,
        "rationale": r.rationale,
    }


@app.get("/api/recommendations")
def get_recommendations(db: Session = Depends(get_db)):
    items = db.query(ChargingRecommendation).order_by(ChargingRecommendation.rank.asc()).all()
    return {"recommendations": [_serialize_rec(r) for r in items]}


@app.get("/api/recommendations/top3")
def get_top3_recommendations(db: Session = Depends(get_db)):
    items = (
        db.query(ChargingRecommendation)
        .filter(ChargingRecommendation.is_top3.is_(True))
        .order_by(ChargingRecommendation.rank.asc())
        .limit(3)
        .all()
    )
    return {"top3": [_serialize_rec(r) for r in items]}


@app.get("/api/delivery-impact")
def get_delivery_impact(db: Session = Depends(get_db)):
    return simulate_delivery_delay_impact(db)


@app.post("/api/ml/train")
def trigger_ml_training(payload: TrainModelsRequest, db: Session = Depends(get_db)):
    summary = train_full_ml_suite(db, random_state=payload.random_state)
    return {"status": "trained", "summary": summary}


@app.post("/api/ml/predict")
def predict_endpoint(payload: LivePredictRequest):
    return predict_vehicle_intelligence(payload.model_dump())


@app.post("/api/data/generate", status_code=status.HTTP_201_CREATED)
def generate_data_endpoint(payload: GenerateDataRequest, db: Session = Depends(get_db)):
    stats = seed_database(
        db, target_records=payload.records, num_vehicles=payload.vehicles, seed=payload.seed
    )
    ml_summary = train_full_ml_suite(db, random_state=payload.seed) if payload.retrain else None
    return {"status": "completed", "pipeline": stats, "training": ml_summary}

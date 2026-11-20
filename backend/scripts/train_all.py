"""Train all EV ML models, persist latest fleet predictions, run K-Means hotspots, and optimize Top 3 stations."""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import SessionLocal, init_db
from app.models import MlPrediction, Telemetry
from app.services.optimizer import optimize_charging_stations
from ml.predict import predict_vehicle_intelligence
from ml.train_demand_model import train_charging_demand_and_hotspots
from ml.train_range_model import train_and_select_range_model
from ml.train_risk_model import train_battery_risk_model


def train_full_ml_suite(db: Session, random_state: int = 42) -> dict:
    init_db()
    range_res = train_and_select_range_model(db, random_state=random_state)
    risk_res = train_battery_risk_model(db, random_state=random_state)
    demand_res = train_charging_demand_and_hotspots(db, random_state=random_state)

    # Refresh per-vehicle predictions
    subq = (
        db.query(Telemetry.vehicle_id, func.max(Telemetry.timestamp).label("max_ts"))
        .group_by(Telemetry.vehicle_id)
        .subquery()
    )
    latest_rows = (
        db.query(Telemetry)
        .join(
            subq,
            (Telemetry.vehicle_id == subq.c.vehicle_id) & (Telemetry.timestamp == subq.c.max_ts),
        )
        .all()
    )

    db.query(MlPrediction).delete()
    for r in latest_rows:
        pred = predict_vehicle_intelligence(
            {
                "battery_percentage": r.battery_percentage,
                "speed_kmh": r.speed_kmh,
                "temperature_c": r.temperature_c,
                "vehicle_weight_kg": r.vehicle_weight_kg,
                "distance_travelled_km": r.distance_travelled_km,
                "energy_consumption_kwh_per_km": r.energy_consumption_kwh_per_km,
                "traffic_level": r.traffic_level,
                "nearest_station_distance_km": r.nearest_station_distance_km,
            }
        )
        db.add(
            MlPrediction(
                vehicle_id=r.vehicle_id,
                telemetry_id=r.id,
                area=r.area,
                predicted_range_km=pred["predictedRangeKm"],
                actual_range_km=round(r.remaining_range_km, 1),
                range_model_name=pred["rangeModel"],
                battery_risk=pred["batteryRisk"],
                risk_probability=pred["riskConfidence"],
                risk_probabilities=pred["riskProbabilities"],
                predicted_charging_demand=120.0,
                nearest_station_distance_km=r.nearest_station_distance_km,
            )
        )
    db.commit()

    recs = optimize_charging_stations(db, top_k=3)
    return {
        "selectedRangeModel": range_res["selected_model"],
        "rangeModels": range_res["comparison"],
        "batteryRiskMetrics": risk_res,
        "chargingDemandMetrics": demand_res,
        "top3Count": sum(1 for r in recs if r.is_top3),
    }


if __name__ == "__main__":
    with SessionLocal() as session:
        summary = train_full_ml_suite(session)
        print("Training completed. Selected range model:", summary["selectedRangeModel"])

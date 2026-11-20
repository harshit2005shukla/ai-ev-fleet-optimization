"""
Model 3 — Area/Hourly Charging Demand Forecasting (XGBoost)
& K-Means Geospatial Hotspot Clustering Pipeline.
"""

from __future__ import annotations

from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from xgboost import XGBRegressor
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import (
    ChargingEvent,
    ChargingStation,
    HotspotCluster,
    MlModelRun,
    Telemetry,
)
from app.services.s3_storage import upload_or_store_local
from app.utils.geo import find_nearest_station, haversine_distance_km

TRAFFIC_MAP = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "SEVERE": 3}


def train_charging_demand_and_hotspots(db: Session, random_state: int = 42) -> dict:
    rows = db.query(Telemetry).order_by(Telemetry.timestamp.desc()).limit(12000).all()
    events = db.query(ChargingEvent).all()
    stations = db.query(ChargingStation).all()

    areas = sorted({r.area for r in rows})
    area_to_code = {a: idx for idx, a in enumerate(areas)}

    event_counts: dict[tuple[str, int], int] = {}
    for ev in events:
        key = (ev.area, ev.start_time.hour)
        event_counts[key] = event_counts.get(key, 0) + 1

    df = pd.DataFrame(
        [
            {
                "id": r.id,
                "vehicle_id": r.vehicle_id,
                "area": r.area,
                "area_code": area_to_code[r.area],
                "hour": r.timestamp.hour,
                "day_of_week": r.timestamp.weekday(),
                "battery": r.battery_percentage,
                "temp": r.temperature_c,
                "traffic": TRAFFIC_MAP.get(r.traffic_level, 1),
                "lat": r.latitude,
                "lon": r.longitude,
                "energy": r.energy_consumption_kwh_per_km,
                "delay": r.delivery_delay_minutes,
                "charging": 1 if r.charging_status == "CHARGING" else 0,
            }
            for r in rows
        ]
    )

    grouped = (
        df.groupby(["area", "area_code", "day_of_week", "hour"], as_index=False)
        .agg(
            number_of_active_evs=("vehicle_id", "nunique"),
            average_battery=("battery", "mean"),
            temperature_c=("temp", "mean"),
            traffic_level=("traffic", "mean"),
            low_bat=("battery", lambda s: int((s < 35).sum())),
        )
    )
    grouped["historical_charging_events"] = grouped.apply(
        lambda r: event_counts.get((r["area"], int(r["hour"])), 0), axis=1
    )
    grouped["expected_charging_demand"] = (
        grouped["number_of_active_evs"] * ((100.0 - grouped["average_battery"]) / 100.0) * 24.5
        + grouped["historical_charging_events"] * 6.8
        + grouped["low_bat"] * 8.2
        + grouped["traffic_level"] * 4.5
    )

    feature_cols = [
        "hour",
        "day_of_week",
        "area_code",
        "number_of_active_evs",
        "average_battery",
        "historical_charging_events",
        "temperature_c",
        "traffic_level",
    ]
    X = grouped[feature_cols].values
    y = grouped["expected_charging_demand"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=random_state
    )
    model = XGBRegressor(
        n_estimators=180,
        max_depth=5,
        learning_rate=0.09,
        random_state=random_state,
    )
    model.fit(X_train, y_train)
    preds = model.predict(X_test)

    mae = round(float(mean_absolute_error(y_test, preds)), 3)
    rmse = round(float(np.sqrt(mean_squared_error(y_test, preds))), 3)
    r2 = round(float(r2_score(y_test, preds)), 4)

    area_forecasts = []
    for area in areas:
        sub = df[df["area"] == area]
        evs = int(sub["vehicle_id"].nunique())
        avg_bat = float(sub["battery"].mean())
        avg_t = float(sub["temp"].mean())
        avg_tr = float(sub["traffic"].mean())
        hourly = []
        for hr in range(24):
            hist = event_counts.get((area, hr), 0)
            p = max(
                0.0,
                float(
                    model.predict(
                        np.array(
                            [[hr, 2, area_to_code[area], max(1, evs // 2), avg_bat, hist, avg_t, avg_tr]]
                        )
                    )[0]
                ),
            )
            hourly.append({"hour": hr, "predictedDemandKwh": round(p, 1)})
        area_forecasts.append(
            {
                "area": area,
                "predictedDailyDemandKwh": round(sum(h["predictedDemandKwh"] for h in hourly), 1),
                "peakHourDemandKwh": max(h["predictedDemandKwh"] for h in hourly),
                "activeVehicles": evs,
                "avgBatteryPct": round(avg_bat, 1),
                "hourly": hourly,
            }
        )

    model_dir = Path(settings.model_path)
    model_dir.mkdir(parents=True, exist_ok=True)
    demand_path = model_dir / "charging_demand_model.joblib"
    joblib.dump(
        {"model": model, "features": feature_cols, "area_to_code": area_to_code},
        demand_path,
    )
    storage_backend, uri = upload_or_store_local(demand_path, "models")

    db.query(MlModelRun).filter(MlModelRun.model_task == "charging_demand").delete()
    db.add(
        MlModelRun(
            model_task="charging_demand",
            algorithm_name="XGBoost Regressor",
            is_selected=True,
            train_samples=len(X_train),
            test_samples=len(X_test),
            metrics={"mae": mae, "rmse": rmse, "r2": r2, "areaForecasts": area_forecasts},
            artifact_path=uri,
            storage_backend=storage_backend,
        )
    )

    # K-Means Hotspot Clustering Pipeline
    db.query(HotspotCluster).delete()
    station_dicts = [
        {"station_id": s.station_id, "latitude": s.latitude, "longitude": s.longitude}
        for s in stations
    ]

    for category, sub_df, k in [
        ("BATTERY_RISK", df[df["battery"] < 32.0], 6),
        ("HIGH_DEMAND", df[(df["charging"] == 1) | (df["battery"] < 44.0)], 6),
        ("HIGH_ACTIVITY", df, 8),
    ]:
        if len(sub_df) < k:
            continue
        km = KMeans(n_clusters=k, random_state=random_state, n_init=10)
        labels = km.fit_predict(sub_df[["lat", "lon"]].values)
        sub_copy = sub_df.copy()
        sub_copy["cid"] = labels

        for cid in range(k):
            grp = sub_copy[sub_copy["cid"] == cid]
            if grp.empty:
                continue
            clat, clon = float(km.cluster_centers_[cid][0]), float(km.cluster_centers_[cid][1])
            _, st_dist = find_nearest_station(clat, clon, station_dicts)
            dists = [
                haversine_distance_km(clat, clon, float(rl), float(rn))
                for rl, rn in zip(grp["lat"], grp["lon"])
            ]
            radius = max(0.9, min(4.2, float(np.percentile(dists, 80))))
            avg_bat = float(grp["battery"].mean())
            crit = int((grp["battery"] < 22.0).sum())
            db.add(
                HotspotCluster(
                    cluster_index=cid,
                    cluster_category=category,
                    area=str(grp["area"].mode().iloc[0]),
                    centroid_lat=round(clat, 6),
                    centroid_lon=round(clon, 6),
                    radius_km=round(radius, 2),
                    point_count=int(len(grp)),
                    vehicle_count=int(grp["vehicle_id"].nunique()),
                    avg_battery_pct=round(avg_bat, 1),
                    critical_events=crit,
                    avg_energy_kwh_per_km=round(float(grp["energy"].mean()), 3),
                    avg_delay_minutes=round(float(grp["delay"].mean()), 1),
                    demand_intensity=round(len(grp) * ((100.0 - avg_bat) / 100.0) * 1.4, 1),
                    nearest_station_distance_km=st_dist,
                    severity_score=round(min(99.5, (100.0 - avg_bat) * 0.5 + st_dist * 4.2), 1),
                )
            )

        if category == "HIGH_ACTIVITY":
            for cid in range(k):
                ids = sub_copy[sub_copy["cid"] == cid]["id"].tolist()[:1000]
                if ids:
                    db.query(Telemetry).filter(Telemetry.id.in_(ids)).update(
                        {"cluster_id": cid, "cluster_category": category},
                        synchronize_session=False,
                    )

    db.commit()
    return {"mae": mae, "rmse": rmse, "r2": r2}


if __name__ == "__main__":
    with SessionLocal() as s:
        print("Charging Demand Model Metrics:", train_charging_demand_and_hotspots(s))

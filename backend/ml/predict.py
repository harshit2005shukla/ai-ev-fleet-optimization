"""Unified real-time ML inference for EV remaining range, battery risk, and charging demand."""

from __future__ import annotations

import joblib
import numpy as np
from app.services.s3_storage import ensure_local_model
from ml.predict_range import predict_remaining_range

TRAFFIC_MAP = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "SEVERE": 3}


def predict_vehicle_intelligence(payload: dict) -> dict:
    range_out = predict_remaining_range(
        battery_percentage=payload["battery_percentage"],
        speed_kmh=payload["speed_kmh"],
        temperature_c=payload["temperature_c"],
        vehicle_weight_kg=payload["vehicle_weight_kg"],
        distance_travelled_km=payload.get("distance_travelled_km", 45.0),
        energy_consumption_kwh_per_km=payload["energy_consumption_kwh_per_km"],
        traffic_level=payload["traffic_level"],
    )

    risk_file = ensure_local_model("battery_risk_model.joblib")
    risk_bundle = joblib.load(risk_file)
    x_risk = np.array(
        [
            [
                payload["battery_percentage"],
                range_out["predicted_range_km"],
                payload["speed_kmh"],
                payload["temperature_c"],
                TRAFFIC_MAP.get(payload["traffic_level"], 1),
                payload["nearest_station_distance_km"],
                payload["energy_consumption_kwh_per_km"],
            ]
        ],
        dtype=float,
    )
    probs = risk_bundle["model"].predict_proba(x_risk)[0]
    classes = risk_bundle["classes"]
    best_idx = int(np.argmax(probs))

    return {
        "predictedRangeKm": range_out["predicted_range_km"],
        "rangeModel": range_out["model_name"],
        "batteryRisk": classes[best_idx],
        "riskConfidence": round(float(probs[best_idx]), 4),
        "riskProbabilities": {
            classes[i]: round(float(probs[i]), 4) for i in range(len(classes))
        },
        "riskModel": "Random Forest Classifier",
    }

"""Load saved champion Remaining Range regression artifact and predict remaining_range_km."""

from __future__ import annotations

import joblib
import numpy as np
from app.services.s3_storage import ensure_local_model

TRAFFIC_MAP = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "SEVERE": 3}


def predict_remaining_range(
    battery_percentage: float,
    speed_kmh: float,
    temperature_c: float,
    vehicle_weight_kg: float,
    distance_travelled_km: float,
    energy_consumption_kwh_per_km: float,
    traffic_level: str = "MEDIUM",
) -> dict:
    model_path = ensure_local_model("best_range_model.joblib")
    if not model_path.exists():
        raise FileNotFoundError(
            f"Trained range model not found at {model_path}. Run `python -m ml.train_range_model`."
        )
    bundle = joblib.load(model_path)
    features = np.array(
        [
            [
                battery_percentage,
                speed_kmh,
                temperature_c,
                vehicle_weight_kg,
                distance_travelled_km,
                energy_consumption_kwh_per_km,
                TRAFFIC_MAP.get(traffic_level.upper(), 1),
            ]
        ],
        dtype=float,
    )
    pred_km = max(0.0, float(bundle["model"].predict(features)[0]))
    return {
        "predicted_range_km": round(pred_km, 1),
        "model_name": bundle["algorithm_name"],
    }

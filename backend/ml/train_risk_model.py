"""
Model 2 — EV Battery Risk Multi-Class Classifier (LOW / MEDIUM / HIGH).
Evaluates Accuracy, Precision, Recall, F1-score, and 3x3 Confusion Matrix.
"""

from __future__ import annotations

from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    precision_recall_fscore_support,
)
from sklearn.model_selection import train_test_split
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import MlModelRun, Telemetry
from app.services.s3_storage import upload_or_store_local

RISK_LABELS = ["LOW", "MEDIUM", "HIGH"]
TRAFFIC_MAP = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "SEVERE": 3}

RISK_FEATURES = [
    "battery_percentage",
    "remaining_range_km",
    "speed_kmh",
    "temperature_c",
    "traffic_encoded",
    "nearest_station_distance_km",
    "energy_consumption_kwh_per_km",
]


def derive_risk_label(r: Telemetry) -> str:
    pts = 0.0
    if r.battery_percentage < 20:
        pts += 4.2
    elif r.battery_percentage < 28:
        pts += 2.9
    elif r.battery_percentage < 38:
        pts += 1.6
    elif r.battery_percentage < 48:
        pts += 0.6

    if r.remaining_range_km < 45:
        pts += 2.6
    elif r.remaining_range_km < 80:
        pts += 1.4
    elif r.remaining_range_km < 115:
        pts += 0.5

    if r.nearest_station_distance_km > 5.5:
        pts += 1.5
    elif r.nearest_station_distance_km > 3.5:
        pts += 0.85

    if r.energy_consumption_kwh_per_km > 0.42:
        pts += 0.9
    elif r.energy_consumption_kwh_per_km > 0.34:
        pts += 0.45

    if r.traffic_level == "SEVERE":
        pts += 0.75
    elif r.traffic_level == "HIGH":
        pts += 0.40

    if r.temperature_c < 5 or r.temperature_c > 34:
        pts += 0.50
    if r.speed_kmh > 85:
        pts += 0.35

    if pts >= 5.2:
        return "HIGH"
    if pts >= 2.8:
        return "MEDIUM"
    return "LOW"


def train_battery_risk_model(db: Session, random_state: int = 42) -> dict:
    rows = db.query(Telemetry).order_by(Telemetry.timestamp.desc()).limit(15000).all()
    df = pd.DataFrame(
        [
            {
                "battery_percentage": r.battery_percentage,
                "remaining_range_km": r.remaining_range_km,
                "speed_kmh": r.speed_kmh,
                "temperature_c": r.temperature_c,
                "traffic_encoded": TRAFFIC_MAP.get(r.traffic_level, 1),
                "nearest_station_distance_km": r.nearest_station_distance_km,
                "energy_consumption_kwh_per_km": r.energy_consumption_kwh_per_km,
                "target": RISK_LABELS.index(derive_risk_label(r)),
            }
            for r in rows
        ]
    )

    X = df[RISK_FEATURES].values
    y = df["target"].values
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=random_state, stratify=y
    )

    clf = RandomForestClassifier(
        n_estimators=180,
        max_depth=12,
        class_weight="balanced_subsample",
        random_state=random_state,
        n_jobs=-1,
    )
    clf.fit(X_train, y_train)
    y_pred = clf.predict(X_test)

    acc = float(accuracy_score(y_test, y_pred))
    p_cls, r_cls, f_cls, sup = precision_recall_fscore_support(
        y_test, y_pred, labels=[0, 1, 2], zero_division=0
    )
    _, _, w_f1, _ = precision_recall_fscore_support(
        y_test, y_pred, average="weighted", zero_division=0
    )
    cm = confusion_matrix(y_test, y_pred, labels=[0, 1, 2]).tolist()

    metrics = {
        "accuracy": round(acc, 4),
        "macroPrecision": round(float(np.mean(p_cls)), 4),
        "macroRecall": round(float(np.mean(r_cls)), 4),
        "macroF1": round(float(np.mean(f_cls)), 4),
        "weightedF1": round(float(w_f1), 4),
        "perClass": {
            RISK_LABELS[i]: {
                "precision": round(float(p_cls[i]), 4),
                "recall": round(float(r_cls[i]), 4),
                "f1": round(float(f_cls[i]), 4),
                "support": int(sup[i]),
            }
            for i in range(3)
        },
        "confusionMatrix": {"labels": RISK_LABELS, "matrix": cm},
        "featureImportances": {
            f.replace("traffic_encoded", "traffic_level"): round(float(v), 4)
            for f, v in zip(RISK_FEATURES, clf.feature_importances_)
        },
    }

    model_dir = Path(settings.model_path)
    model_dir.mkdir(parents=True, exist_ok=True)
    out_file = model_dir / "battery_risk_model.joblib"
    joblib.dump({"classes": RISK_LABELS, "features": RISK_FEATURES, "model": clf}, out_file)
    storage_backend, uri = upload_or_store_local(out_file, "models")

    db.query(MlModelRun).filter(MlModelRun.model_task == "battery_risk").delete()
    db.add(
        MlModelRun(
            model_task="battery_risk",
            algorithm_name="Random Forest Classifier",
            is_selected=True,
            train_samples=len(X_train),
            test_samples=len(X_test),
            metrics=metrics,
            artifact_path=uri,
            storage_backend=storage_backend,
        )
    )
    db.commit()
    return metrics


if __name__ == "__main__":
    with SessionLocal() as s:
        m = train_battery_risk_model(s)
        print("Battery Risk Classifier:", m["macroF1"], "Macro F1")

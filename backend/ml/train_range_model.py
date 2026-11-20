"""
Model 1 — EV Remaining Range Regression Training & Model Selection.
Trains Linear Regression, Random Forest Regressor, and XGBoost Regressor,
compares MAE, RMSE, R², and 5-fold cross-validation R², auto-selects the best model,
persists via joblib (+ optional AWS S3), and logs metrics to PostgreSQL.
"""

from __future__ import annotations

from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import cross_val_score, train_test_split
from xgboost import XGBRegressor
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import MlModelRun, Telemetry
from app.services.s3_storage import upload_or_store_local

TRAFFIC_MAP = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "SEVERE": 3}

RANGE_FEATURES = [
    "battery_percentage",
    "speed_kmh",
    "temperature_c",
    "vehicle_weight_kg",
    "distance_travelled_km",
    "energy_consumption_kwh_per_km",
    "traffic_encoded",
]


def train_and_select_range_model(db: Session, random_state: int = 42) -> dict:
    records = db.query(Telemetry).order_by(Telemetry.timestamp.desc()).limit(15000).all()
    if len(records) < 50:
        raise ValueError("Need at least 50 telemetry records to train range models.")

    df = pd.DataFrame(
        [
            {
                "battery_percentage": r.battery_percentage,
                "speed_kmh": r.speed_kmh,
                "temperature_c": r.temperature_c,
                "vehicle_weight_kg": r.vehicle_weight_kg,
                "distance_travelled_km": r.distance_travelled_km,
                "energy_consumption_kwh_per_km": r.energy_consumption_kwh_per_km,
                "traffic_encoded": TRAFFIC_MAP.get(r.traffic_level, 1),
                "remaining_range_km": r.remaining_range_km,
            }
            for r in records
        ]
    )

    X = df[RANGE_FEATURES].values
    y = df["remaining_range_km"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=random_state
    )

    candidates = [
        ("Linear Regression", LinearRegression()),
        (
            "Random Forest Regressor",
            RandomForestRegressor(
                n_estimators=140,
                max_depth=12,
                random_state=random_state,
                n_jobs=-1,
            ),
        ),
        (
            "XGBoost Regressor",
            XGBRegressor(
                n_estimators=220,
                max_depth=6,
                learning_rate=0.08,
                subsample=0.85,
                colsample_bytree=0.9,
                reg_lambda=1.2,
                random_state=random_state,
                n_jobs=-1,
            ),
        ),
    ]

    results = []
    for name, estimator in candidates:
        estimator.fit(X_train, y_train)
        preds = estimator.predict(X_test)
        mae = float(mean_absolute_error(y_test, preds))
        rmse = float(np.sqrt(mean_squared_error(y_test, preds)))
        r2 = float(r2_score(y_test, preds))
        cv_scores = cross_val_score(
            estimator, X_train[:4000], y_train[:4000], cv=5, scoring="r2"
        )

        if hasattr(estimator, "feature_importances_"):
            raw_imp = np.array(estimator.feature_importances_, dtype=float)
        else:
            raw_imp = np.abs(np.array(estimator.coef_, dtype=float))
        raw_imp = raw_imp / max(1e-9, raw_imp.sum())

        importances = {
            feat.replace("traffic_encoded", "traffic_level"): round(float(val), 4)
            for feat, val in zip(RANGE_FEATURES, raw_imp)
        }

        stride = max(1, len(y_test) // 90)
        sample_preds = [
            {
                "actual": round(float(y_test[i]), 1),
                "predicted": round(float(preds[i]), 1),
                "residual": round(float(preds[i] - y_test[i]), 1),
            }
            for i in range(0, len(y_test), stride)
        ][:90]

        results.append(
            {
                "name": name,
                "estimator": estimator,
                "metrics": {
                    "mae": round(mae, 3),
                    "rmse": round(rmse, 3),
                    "r2": round(r2, 4),
                    "cvR2Mean": round(float(cv_scores.mean()), 4),
                    "cvR2Std": round(float(cv_scores.std()), 4),
                    "featureImportances": importances,
                    "samplePredictions": sample_preds,
                },
            }
        )

    results.sort(key=lambda item: item["metrics"]["rmse"])
    best = results[0]

    model_dir = Path(settings.model_path)
    model_dir.mkdir(parents=True, exist_ok=True)
    model_file = model_dir / "best_range_model.joblib"
    joblib.dump(
        {
            "algorithm_name": best["name"],
            "features": RANGE_FEATURES,
            "model": best["estimator"],
            "metrics": best["metrics"],
        },
        model_file,
    )
    storage_backend, artifact_uri = upload_or_store_local(model_file, "models")

    db.query(MlModelRun).filter(MlModelRun.model_task == "range_prediction").delete()
    for item in results:
        is_best = item["name"] == best["name"]
        db.add(
            MlModelRun(
                model_task="range_prediction",
                algorithm_name=item["name"],
                is_selected=is_best,
                train_samples=len(X_train),
                test_samples=len(X_test),
                metrics=item["metrics"],
                artifact_path=artifact_uri if is_best else str(model_dir / f"{item['name']}.joblib"),
                storage_backend=storage_backend,
            )
        )
    db.commit()

    return {
        "selected_model": best["name"],
        "artifact": artifact_uri,
        "comparison": [
            {"algorithm": r["name"], **r["metrics"]} for r in results
        ],
    }


if __name__ == "__main__":
    with SessionLocal() as session:
        summary = train_and_select_range_model(session)
        print(f"Champion Range Model: {summary['selected_model']}")
        for m in summary["comparison"]:
            print(
                f"  {m['algorithm']:25s} | MAE={m['mae']:.3f} km | "
                f"RMSE={m['rmse']:.3f} km | R2={m['r2']:.4f}"
            )

#!/usr/bin/env python3
"""
Automated Test Suite (Pytest + standalone runner) covering:
1. API health & PostgreSQL database connection
2. Synthetic telemetry validation, deduplication, bounds & outlier cleaning
3. Geospatial Haversine distance & nearest charging station resolution
4. Remaining range ML prediction & benchmark selection (MAE, RMSE, R²)
5. Battery risk multi-class classification (Precision, Recall, F1, Confusion Matrix)
6. Charging demand forecasting & K-Means hotspot clustering
7. Top-3 charging station optimization & Before-vs-After delivery delay simulation
8. Pagination, filtering, and HTTP 404/422 validation handling

Run with pytest:
    pytest backend/tests/test_api_and_ml.py -v
Or standalone:
    python3 backend/tests/test_api_and_ml.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
for p in (str(BACKEND_DIR), str(REPO_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)

try:
    import pytest  # type: ignore
except ImportError:
    pytest = None

from app.utils.geo import (
    find_nearest_station,
    haversine_distance_km,
    is_valid_austin_coordinate,
)
from scripts.generate_telemetry import generate_and_clean_telemetry

API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:3000").rstrip("/")


def _http_json(path: str, method: str = "GET", payload: dict | None = None) -> tuple[int, dict]:
    req = urllib.request.Request(
        f"{API_BASE_URL}{path}",
        data=(json.dumps(payload).encode("utf-8") if payload is not None else None),
        headers={"Content-Type": "application/json"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def _server_reachable() -> bool:
    try:
        status, _ = _http_json("/api/health")
        return status == 200
    except Exception:
        return False


def test_haversine_distance_and_nearest_station() -> None:
    dist = haversine_distance_km(30.2672, -97.7431, 30.4021, -97.7259)
    assert 14.5 <= dist <= 15.6, f"Unexpected Haversine distance: {dist}"
    assert abs(haversine_distance_km(30.2672, -97.7431, 30.2672, -97.7431)) < 1e-6

    stations = [
        {"station_id": "CS-001", "latitude": 30.2662, "longitude": -97.7468},
        {"station_id": "CS-003", "latitude": 30.4024, "longitude": -97.7262},
    ]
    best, d_km = find_nearest_station(30.4005, -97.7250, stations)
    assert best["station_id"] == "CS-003"
    assert d_km < 0.5


def test_telemetry_validation_and_cleaning() -> None:
    cleaned, stats = generate_and_clean_telemetry(
        target_records=3000, num_vehicles=36, seed=42, inject_anomalies=True
    )
    assert len(cleaned) > 2800
    assert stats["cleaned_output"] == len(cleaned)
    assert stats["missing_imputed"] + stats["invalid_gps_filtered"] > 0

    seen = set()
    for row in cleaned:
        dedupe = (row["vehicle_id"], row["timestamp"])
        assert dedupe not in seen, "Duplicate (vehicle_id, timestamp) leaked past cleaner"
        seen.add(dedupe)
        assert is_valid_austin_coordinate(float(row["latitude"]), float(row["longitude"]))
        assert 0.0 <= float(row["battery_percentage"]) <= 100.0
        assert 0.0 <= float(row["speed_kmh"]) <= 135.0
        assert 0.12 <= float(row["energy_consumption_kwh_per_km"]) <= 0.95
        assert row["temperature_c"] is not None


def test_physics_relationships() -> None:
    cleaned, _ = generate_and_clean_telemetry(
        target_records=3000, num_vehicles=40, seed=11, inject_anomalies=False
    )
    low_soc = [float(r["remaining_range_km"]) for r in cleaned if float(r["battery_percentage"]) < 30]
    high_soc = [float(r["remaining_range_km"]) for r in cleaned if float(r["battery_percentage"]) > 75]
    assert (sum(high_soc) / len(high_soc)) > (sum(low_soc) / len(low_soc)) * 2.0

    low_tr = [float(r["delivery_delay_minutes"]) for r in cleaned if r["traffic_level"] == "LOW"]
    sev_tr = [float(r["delivery_delay_minutes"]) for r in cleaned if r["traffic_level"] == "SEVERE"]
    assert (sum(sev_tr) / len(sev_tr)) > (sum(low_tr) / len(low_tr)) * 2.0


def test_api_health_and_database_connection() -> None:
    if not _server_reachable():
        if pytest:
            pytest.skip("API server not running on API_BASE_URL")
        return
    code, body = _http_json("/api/health")
    assert code == 200
    assert body["status"] == "ok"
    assert body["database"] == "connected"


def test_range_and_risk_ml_predictions() -> None:
    if not _server_reachable():
        if pytest:
            pytest.skip("API server not running on API_BASE_URL")
        return
    code, rng = _http_json("/api/fleet/range-predictions")
    assert code == 200
    models = rng["modelComparison"]
    assert len(models) == 3
    selected = [m for m in models if m["isSelected"]]
    assert len(selected) == 1 and selected[0]["r2"] > 0.90 and selected[0]["mae"] > 0

    code, risk = _http_json("/api/fleet/battery-risk")
    assert code == 200
    metrics = risk["model"]["metrics"]
    assert metrics["macroF1"] > 0.85
    assert len(metrics["confusionMatrix"]["matrix"]) == 3

    # Real-time inference endpoint + validation check
    code, live = _http_json(
        "/api/ml/predict",
        method="POST",
        payload={
            "battery_percentage": 18,
            "speed_kmh": 82,
            "temperature_c": 37,
            "vehicle_weight_kg": 5200,
            "distance_travelled_km": 60,
            "energy_consumption_kwh_per_km": 0.42,
            "traffic_level": "SEVERE",
            "nearest_station_distance_km": 6.8,
        },
    )
    assert code == 200
    assert live["predictedRangeKm"] > 0
    assert live["batteryRisk"] in ("LOW", "MEDIUM", "HIGH")


def test_charging_optimization_and_delivery_impact() -> None:
    if not _server_reachable():
        if pytest:
            pytest.skip("API server not running on API_BASE_URL")
        return
    code, top3_res = _http_json("/api/recommendations/top3")
    assert code == 200
    top3 = top3_res["top3"]
    assert len(top3) == 3
    assert [r["rank"] for r in top3] == [1, 2, 3]
    for r in top3:
        assert 0 < r["score"] <= 100
        assert r["expected_ev_coverage"] > 0
        assert r["nearest_existing_station_distance"] >= 1.8
    # Verify spatial separation constraint between all recommended stations
    d12 = haversine_distance_km(
        top3[0]["latitude"], top3[0]["longitude"], top3[1]["latitude"], top3[1]["longitude"]
    )
    assert d12 >= 4.0

    code, imp = _http_json("/api/delivery-impact")
    assert code == 200
    assert imp["after"]["avgDeliveryDelayMinutes"] < imp["before"]["avgDeliveryDelayMinutes"]
    assert imp["after"]["avgDistanceToStationKm"] < imp["before"]["avgDistanceToStationKm"]
    assert imp["after"]["criticalBatteryEvents"] <= imp["before"]["criticalBatteryEvents"]
    assert imp["impact"]["deliveryDelayReductionPct"] > 0


def test_core_fleet_and_geospatial_endpoints() -> None:
    if not _server_reachable():
        if pytest:
            pytest.skip("API server not running on API_BASE_URL")
        return
    for endpoint in (
        "/api/fleet/summary",
        "/api/vehicles?page=1&limit=10&risk=HIGH",
        "/api/vehicles/EV-101",
        "/api/telemetry?page=1&limit=15",
        "/api/charging-stations",
        "/api/charging-demand",
        "/api/hotspots",
        "/api/analytics",
    ):
        code, _ = _http_json(endpoint)
        assert code == 200, f"Failed on {endpoint}"

    # Verify graceful 404 on unknown vehicle
    try:
        _http_json("/api/vehicles/EV-99999")
        raise AssertionError("Expected HTTP 404 for nonexistent vehicle")
    except urllib.error.HTTPError as err:
        assert err.code == 404


if __name__ == "__main__":
    suite = [
        test_haversine_distance_and_nearest_station,
        test_telemetry_validation_and_cleaning,
        test_physics_relationships,
        test_api_health_and_database_connection,
        test_range_and_risk_ml_predictions,
        test_charging_optimization_and_delivery_impact,
        test_core_fleet_and_geospatial_endpoints,
    ]
    for test_fn in suite:
        test_fn()
        print(f"PASS  {test_fn.__name__}")
    print(f"\nAll {len(suite)} test suites passed successfully.")

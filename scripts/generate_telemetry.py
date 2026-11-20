#!/usr/bin/env python3
"""
Synthetic EV Fleet Telemetry Generator & Data Cleaning Pipeline.

Usage:
    python scripts/generate_telemetry.py --records 100000
    python scripts/generate_telemetry.py --records 25000 --vehicles 60 --seed 42 --output data/processed/telemetry.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

EARTH_RADIUS_KM = 6371.0088

VALID_BOUNDS = {
    "min_lat": 30.10,
    "max_lat": 30.56,
    "min_lon": -97.95,
    "max_lon": -97.52,
}

FLEET_AREAS = [
    ("Downtown Core", 30.2685, -97.7428, 0.018, 0.020, 0.78, 1.02, 0.85),
    ("North Tech Corridor", 30.4018, -97.7245, 0.022, 0.024, 0.66, 1.01, 0.90),
    ("East Austin Logistics", 30.2725, -97.6625, 0.022, 0.025, 0.72, 1.04, 1.18),
    ("South Congress & St. Elmo", 30.2165, -97.7565, 0.020, 0.022, 0.62, 1.03, 0.82),
    ("Southeast Airport Freight", 30.2035, -97.6580, 0.024, 0.026, 0.74, 1.06, 1.28),
    ("Round Rock North Depot", 30.4725, -97.6760, 0.024, 0.026, 0.69, 1.05, 1.22),
    ("Sunset Valley & Southwest", 30.2295, -97.8195, 0.021, 0.023, 0.58, 1.09, 0.86),
    ("Pflugerville Industrial", 30.4385, -97.6145, 0.023, 0.025, 0.67, 1.04, 1.24),
]

CHARGING_STATIONS = [
    ("CS-001", "Downtown Republic Fast Hub", "Downtown Core", 30.2662, -97.7468, 10, 250, 81.4),
    ("CS-002", "East 5th Plaza Supercharger", "Downtown Core", 30.2654, -97.7312, 8, 180, 74.2),
    ("CS-003", "Domain Tech Parkway Hub", "North Tech Corridor", 30.4024, -97.7262, 12, 350, 77.8),
    ("CS-004", "Research Blvd North Station", "North Tech Corridor", 30.3865, -97.7398, 8, 150, 68.5),
    ("CS-005", "St. Elmo Fleet Plaza", "South Congress & St. Elmo", 30.2198, -97.7582, 10, 250, 72.1),
    ("CS-006", "South Lamar Transit Chargers", "South Congress & St. Elmo", 30.2392, -97.7724, 6, 150, 64.9),
    ("CS-007", "Sunset Valley Brodie Station", "Sunset Valley & Southwest", 30.2312, -97.8165, 8, 180, 59.3),
    ("CS-008", "Mueller Central Charging Plaza", "East Austin Logistics", 30.2986, -97.7052, 6, 150, 89.6),
    ("CS-009", "Parmer Tech Ridge Station", "North Tech Corridor", 30.4155, -97.6845, 6, 150, 86.2),
    ("CS-010", "Riverside East QuickCharge", "South Congress & St. Elmo", 30.2385, -97.7165, 6, 120, 83.7),
]

VEHICLE_SPECS = [
    ("Compact Cargo Van", "Rivian EDV-500", 72.0, 2150.0, 1050.0, 305.0, 0.210, 1.00),
    ("Mid-Size Step Van", "BrightDrop Zevo 600", 96.0, 2850.0, 1650.0, 335.0, 0.255, 1.08),
    ("Refrigerated EV Van", "Mercedes eSprinter ColdChain", 104.0, 3100.0, 1500.0, 295.0, 0.295, 1.32),
    ("Heavy Box Truck", "Volvo FL Electric", 142.0, 4300.0, 3100.0, 350.0, 0.355, 1.15),
]

FIELDNAMES = [
    "vehicle_id",
    "trip_id",
    "timestamp",
    "latitude",
    "longitude",
    "battery_percentage",
    "speed_kmh",
    "distance_travelled_km",
    "remaining_range_km",
    "temperature_c",
    "vehicle_weight_kg",
    "energy_consumption_kwh_per_km",
    "traffic_level",
    "delivery_status",
    "delivery_delay_minutes",
    "charging_status",
    "charging_station_id",
    "nearest_station_id",
    "nearest_station_distance_km",
    "area",
]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2.0) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2.0) ** 2
    return EARTH_RADIUS_KM * (2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a))))


def nearest_station(lat: float, lon: float) -> Tuple[str, float, float]:
    best_id = CHARGING_STATIONS[0][0]
    best_util = CHARGING_STATIONS[0][7]
    best_dist = float("inf")
    for st in CHARGING_STATIONS:
        d = haversine_km(lat, lon, st[3], st[4])
        if d < best_dist:
            best_dist = d
            best_id = st[0]
            best_util = st[7]
    return best_id, round(best_dist, 3), best_util


def thermal_penalty(temp_c: float, sensitivity: float) -> float:
    if temp_c < 18.0:
        diff = 18.0 - temp_c
        return 1.0 + min(0.42, 0.0095 * diff + 0.00028 * diff * diff) * sensitivity
    if temp_c > 25.0:
        diff = temp_c - 25.0
        return 1.0 + min(0.36, 0.0085 * diff + 0.00032 * diff * diff) * sensitivity
    return 1.0


def compute_energy_consumption(
    base_kwh_km: float,
    speed_kmh: float,
    weight_kg: float,
    temp_c: float,
    traffic: str,
    elev_factor: float,
    hvac_sens: float,
) -> float:
    speed_delta = max(0.0, speed_kmh - 40.0)
    aero = 1.0 + 0.000095 * speed_delta * speed_delta + (0.06 if 0.0 < speed_kmh < 18.0 else 0.0)
    mass = 1.0 + max(0.0, weight_kg - 2100.0) * 0.000088
    therm = thermal_penalty(temp_c, hvac_sens)
    t_mult = {"LOW": 1.0, "MEDIUM": 1.06, "HIGH": 1.14, "SEVERE": 1.24}.get(traffic, 1.06)
    return base_kwh_km * aero * mass * therm * t_mult * elev_factor


def generate_and_clean_telemetry(
    target_records: int = 100_000,
    num_vehicles: int = 80,
    seed: int = 42,
    inject_anomalies: bool = True,
) -> Tuple[List[Dict[str, object]], Dict[str, int]]:
    rng = random.Random(seed)
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    start_anchor = now - timedelta(days=14)

    vehicles = []
    for i in range(1, num_vehicles + 1):
        vid = f"EV-{100 + i:03d}"
        spec = VEHICLE_SPECS[(i - 1) % len(VEHICLE_SPECS)]
        home_area = FLEET_AREAS[(i - 1) % len(FLEET_AREAS)]
        vehicles.append((vid, spec, home_area))

    points_per_trip = 10
    total_trips = max(1, math.ceil(target_records / points_per_trip))

    raw_rows: List[Dict[str, object]] = []
    for t_idx in range(total_trips):
        if len(raw_rows) >= target_records:
            break
        vid, spec, origin = vehicles[t_idx % num_vehicles]
        _, _, batt_kwh, curb_kg, max_payload, _, base_cons, hvac_sens = spec
        dest = origin if rng.random() < 0.62 else rng.choice(FLEET_AREAS)
        trip_id = f"TRP-{100001 + t_idx}"

        offset_minutes = rng.randint(0, 14 * 24 * 60 - 180)
        ts = start_anchor + timedelta(minutes=offset_minutes)

        _, dest_dist, _ = nearest_station(dest[1], dest[2])
        underserved = dest_dist > 4.2
        battery_pct = rng.uniform(36.0, 88.0) if underserved else rng.uniform(52.0, 97.0)
        if rng.random() < (0.28 if underserved else 0.10):
            battery_pct = rng.uniform(22.0, 45.0)

        weight_kg = round(curb_kg + max_payload * rng.uniform(0.20, 0.95), 1)
        cum_dist = 0.0

        for step in range(points_per_trip):
            if len(raw_rows) >= target_records:
                break
            frac = (step + 1) / points_per_trip
            ts = ts + timedelta(minutes=rng.randint(8, 16))
            hr = ts.hour

            area = origin if frac < 0.4 else dest
            lat = round(origin[1] + (dest[1] - origin[1]) * frac + rng.gauss(0.0, area[3] * 0.55), 6)
            lon = round(origin[2] + (dest[2] - origin[2]) * frac + rng.gauss(0.0, area[4] * 0.55), 6)

            seasonal_shift = ((ts.day % 5) - 2) * 5.5
            diurnal = math.sin(((hr - 5) / 24.0) * 2.0 * math.pi) * 8.5
            temp_c: Optional[float] = round(
                max(-4.0, min(42.0, 21.0 + seasonal_shift + diurnal + rng.gauss(0.0, 2.2))), 1
            )

            rush = 1.0 if hr in (7, 8, 9, 16, 17, 18, 19) else 0.0
            t_score = area[5] * 0.65 + (0.33 * rush) + rng.uniform(-0.18, 0.22)
            traffic = (
                "SEVERE"
                if t_score >= 0.88
                else "HIGH"
                if t_score >= 0.68
                else "MEDIUM"
                if t_score >= 0.45
                else "LOW"
            )

            speed_bounds = {
                "SEVERE": (14.0, 34.0),
                "HIGH": (26.0, 54.0),
                "MEDIUM": (42.0, 78.0),
                "LOW": (55.0, 102.0),
            }[traffic]
            speed_kmh: Optional[float] = round(rng.uniform(*speed_bounds), 1)

            seg_km = round(max(1.5, speed_kmh * rng.uniform(0.15, 0.26)), 2)
            cum_dist = round(cum_dist + seg_km, 2)

            cons = compute_energy_consumption(
                base_cons, speed_kmh, weight_kg, temp_c, traffic, area[6], hvac_sens
            ) * (1.0 + rng.gauss(0.0, 0.04))
            cons = round(max(0.14, cons), 4)

            battery_pct = max(4.0, battery_pct - ((seg_km * cons) / batt_kwh) * 100.0)
            b_val: Optional[float] = round(battery_pct, 1)

            rem_range = round(
                max(5.0, ((b_val / 100.0) * batt_kwh / cons) * (1.0 + rng.gauss(0.0, 0.035))),
                1,
            )

            st_id, st_dist, st_util = nearest_station(lat, lon)
            traffic_delay = {
                "SEVERE": rng.uniform(9.0, 21.0),
                "HIGH": rng.uniform(4.5, 12.5),
                "MEDIUM": rng.uniform(1.0, 5.5),
                "LOW": rng.uniform(0.0, 2.2),
            }[traffic]
            detour_delay = 0.0
            if b_val < 28.0:
                urgency = (28.0 - b_val) / 22.0
                detour_delay = ((st_dist * 2.0) / 36.0) * 60.0 * (0.55 + 0.55 * urgency) + (
                    (8.5 if st_util > 80 else 3.2) * urgency
                )

            delay_min = round(max(0.0, traffic_delay + detour_delay + rng.gauss(0.0, 0.7)), 1)
            is_charging = step == points_per_trip - 1 and b_val < 33.0 and rng.random() < 0.7
            charging_status = "CHARGING" if is_charging else "DISCHARGING"
            charging_station_id = st_id if is_charging else ""
            delivery_status = (
                "DELAYED"
                if delay_min > 14.0
                else ("DELIVERED" if step == points_per_trip - 1 else "ON_TIME")
            )

            rec: Dict[str, object] = {
                "vehicle_id": vid,
                "trip_id": trip_id,
                "timestamp": ts.isoformat(),
                "latitude": lat,
                "longitude": lon,
                "battery_percentage": b_val,
                "speed_kmh": speed_kmh,
                "distance_travelled_km": cum_dist,
                "remaining_range_km": rem_range,
                "temperature_c": temp_c,
                "vehicle_weight_kg": weight_kg,
                "energy_consumption_kwh_per_km": cons,
                "traffic_level": traffic,
                "delivery_status": delivery_status,
                "delivery_delay_minutes": delay_min,
                "charging_status": charging_status,
                "charging_station_id": charging_station_id,
                "nearest_station_id": st_id,
                "nearest_station_distance_km": st_dist,
                "area": area[0],
            }

            if inject_anomalies and rng.random() < 0.018:
                fault = rng.random()
                if fault < 0.20:
                    rec["temperature_c"] = None
                elif fault < 0.36:
                    rec["speed_kmh"] = None
                elif fault < 0.52:
                    rec["latitude"] = 0.0
                    rec["longitude"] = 0.0
                elif fault < 0.68:
                    rec["battery_percentage"] = 109.0 if fault < 0.60 else -3.5
                elif fault < 0.82:
                    rec["speed_kmh"] = 192.0
                elif fault < 0.92:
                    rec["energy_consumption_kwh_per_km"] = 2.6
                else:
                    raw_rows.append(dict(rec))

            raw_rows.append(rec)

    # Validation & Data Cleaning Pipeline
    stats = {
        "raw_generated": len(raw_rows),
        "missing_imputed": 0,
        "duplicates_removed": 0,
        "invalid_gps_filtered": 0,
        "invalid_battery_handled": 0,
        "invalid_speed_filtered": 0,
        "outliers_capped": 0,
        "cleaned_output": 0,
    }

    seen = set()
    cleaned: List[Dict[str, object]] = []
    default_temp = 21.5
    default_speed = 48.0

    for row in raw_rows:
        # Normalize timestamp to UTC ISO-8601
        ts_str = str(row["timestamp"]).replace("Z", "+00:00")
        dt = datetime.fromisoformat(ts_str).astimezone(timezone.utc)
        norm_ts = dt.isoformat()

        dedupe_key = (row["vehicle_id"], norm_ts)
        if dedupe_key in seen:
            stats["duplicates_removed"] += 1
            continue
        seen.add(dedupe_key)

        lat_v = float(row["latitude"])  # type: ignore[arg-type]
        lon_v = float(row["longitude"])  # type: ignore[arg-type]
        if not (
            VALID_BOUNDS["min_lat"] <= lat_v <= VALID_BOUNDS["max_lat"]
            and VALID_BOUNDS["min_lon"] <= lon_v <= VALID_BOUNDS["max_lon"]
        ):
            stats["invalid_gps_filtered"] += 1
            continue

        if row["temperature_c"] is None:
            row["temperature_c"] = default_temp
            stats["missing_imputed"] += 1
        if row["speed_kmh"] is None:
            row["speed_kmh"] = default_speed
            stats["missing_imputed"] += 1

        spd = float(row["speed_kmh"])  # type: ignore[arg-type]
        if spd < 0.0 or spd > 135.0:
            stats["invalid_speed_filtered"] += 1
            continue

        bat = row["battery_percentage"]
        if bat is None or float(bat) < 0.0:  # type: ignore[arg-type]
            stats["invalid_battery_handled"] += 1
            continue
        if float(bat) > 100.0:  # type: ignore[arg-type]
            row["battery_percentage"] = 100.0
            stats["invalid_battery_handled"] += 1

        ec = float(row["energy_consumption_kwh_per_km"])  # type: ignore[arg-type]
        if ec < 0.12 or ec > 0.95:
            row["energy_consumption_kwh_per_km"] = max(0.12, min(0.95, ec))
            stats["outliers_capped"] += 1

        row["timestamp"] = norm_ts
        cleaned.append(row)

    stats["cleaned_output"] = len(cleaned)
    return cleaned, stats


def maybe_upload_s3(local_path: Path, s3_key: str) -> Optional[str]:
    bucket = os.getenv("S3_BUCKET_NAME", "").strip()
    key_id = os.getenv("AWS_ACCESS_KEY_ID", "").strip()
    secret = os.getenv("AWS_SECRET_ACCESS_KEY", "").strip()
    region = os.getenv("AWS_REGION", "us-east-1").strip()
    if not (bucket and key_id and secret):
        return None
    try:
        import boto3  # type: ignore

        s3 = boto3.client(
            "s3",
            region_name=region,
            aws_access_key_id=key_id,
            aws_secret_access_key=secret,
        )
        s3.upload_file(str(local_path), bucket, s3_key)
        return f"s3://{bucket}/{s3_key}"
    except Exception as exc:
        print(f"[S3] Warning — falling back to local storage ({exc})")
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate realistic synthetic EV fleet telemetry.")
    parser.add_argument("--records", type=int, default=100_000, help="Number of raw records to generate")
    parser.add_argument("--vehicles", type=int, default=80, help="Fleet size (number of EVs)")
    parser.add_argument("--seed", type=int, default=42, help="Reproducible random seed")
    parser.add_argument(
        "--output",
        type=str,
        default="data/processed/ev_telemetry_cleaned.csv",
        help="Cleaned CSV destination path",
    )
    args = parser.parse_args()

    t0 = time.perf_counter()
    cleaned, stats = generate_and_clean_telemetry(
        target_records=max(100, args.records),
        num_vehicles=max(10, args.vehicles),
        seed=args.seed,
    )

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(cleaned)

    stats_path = Path("data/raw/pipeline_manifest.json")
    stats_path.parent.mkdir(parents=True, exist_ok=True)
    s3_uri = maybe_upload_s3(out_path, f"processed/{out_path.name}")
    elapsed = round(time.perf_counter() - t0, 2)

    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed,
        "vehicles": args.vehicles,
        "duration_seconds": elapsed,
        "output_csv": str(out_path),
        "s3_uri": s3_uri or "local-fallback",
        "stats": stats,
    }
    stats_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    maybe_upload_s3(stats_path, "raw/pipeline_manifest.json")

    print(f"[EV Telemetry Pipeline] Completed in {elapsed}s")
    print(f"  Raw records generated : {stats['raw_generated']:,}")
    print(f"  Cleaned rows saved    : {stats['cleaned_output']:,} -> {out_path}")
    print(
        f"  Data cleaning summary : imputed={stats['missing_imputed']}, "
        f"deduped={stats['duplicates_removed']}, bad_gps={stats['invalid_gps_filtered']}, "
        f"bad_battery={stats['invalid_battery_handled']}, bad_speed={stats['invalid_speed_filtered']}, "
        f"outliers_capped={stats['outliers_capped']}"
    )
    print(f"  Storage destination   : {s3_uri or 'Local storage (AWS credentials not set)'}")


if __name__ == "__main__":
    main()

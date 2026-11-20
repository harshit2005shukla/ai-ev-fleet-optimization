"""Seed PostgreSQL with synthetic EV fleet vehicles, stations, trips, cleaned telemetry, and charging events."""

from __future__ import annotations

from datetime import datetime, timedelta
import sys
from pathlib import Path
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from app.database import SessionLocal, init_db
from app.models import ChargingEvent, ChargingStation, Telemetry, Trip, Vehicle
from scripts.generate_telemetry import (
    CHARGING_STATIONS,
    FLEET_AREAS,
    VEHICLE_SPECS,
    generate_and_clean_telemetry,
)


def seed_database(db: Session, target_records: int = 6000, num_vehicles: int = 60, seed: int = 42) -> dict:
    init_db()
    cleaned, stats = generate_and_clean_telemetry(
        target_records=target_records, num_vehicles=num_vehicles, seed=seed
    )

    db.query(ChargingEvent).delete()
    db.query(Telemetry).delete()
    db.query(Trip).delete()
    db.query(Vehicle).delete()
    db.query(ChargingStation).delete()
    db.commit()

    for st_id, name, area, lat, lon, ports, kw, util in CHARGING_STATIONS:
        db.add(
            ChargingStation(
                station_id=st_id,
                name=name,
                area=area,
                latitude=lat,
                longitude=lon,
                total_ports=ports,
                available_ports=max(1, ports // 3),
                max_power_kw=float(kw),
                avg_utilization_pct=util,
            )
        )

    for i in range(1, num_vehicles + 1):
        vid = f"EV-{100 + i:03d}"
        vtype, model, kwh, _, max_pay, nom_r, _, _ = VEHICLE_SPECS[(i - 1) % len(VEHICLE_SPECS)]
        home = FLEET_AREAS[(i - 1) % len(FLEET_AREAS)][0]
        db.add(
            Vehicle(
                vehicle_id=vid,
                fleet_code=f"ATX-FLT-{i:03d}",
                model_name=model,
                vehicle_type=vtype,
                battery_capacity_kwh=kwh,
                max_payload_kg=max_pay,
                nominal_range_km=nom_r,
                home_area=home,
                status="active" if i % 5 != 0 else "charging",
            )
        )
    db.commit()

    by_trip: dict[str, list[dict]] = {}
    for row in cleaned:
        by_trip.setdefault(str(row["trip_id"]), []).append(row)

    for tid, pts in by_trip.items():
        pts.sort(key=lambda r: str(r["timestamp"]))
        first, last = pts[0], pts[-1]
        db.add(
            Trip(
                trip_id=tid,
                vehicle_id=str(first["vehicle_id"]),
                origin_area=str(first["area"]),
                destination_area=str(last["area"]),
                start_time=datetime.fromisoformat(str(first["timestamp"])),
                end_time=datetime.fromisoformat(str(last["timestamp"])),
                total_distance_km=float(last["distance_travelled_km"]),
                start_battery_pct=float(first["battery_percentage"]),
                end_battery_pct=float(last["battery_percentage"]),
                energy_used_kwh=round(
                    float(last["distance_travelled_km"]) * float(last["energy_consumption_kwh_per_km"]), 2
                ),
                cargo_weight_kg=max(200.0, float(first["vehicle_weight_kg"]) - 2200.0),
                delivery_status=str(last["delivery_status"]),
                delivery_delay_minutes=float(last["delivery_delay_minutes"]),
            )
        )
    db.commit()

    tel_objs = []
    ev_objs = []
    for row in cleaned:
        ts = datetime.fromisoformat(str(row["timestamp"]))
        cs_id = str(row["charging_station_id"]) or None
        tel_objs.append(
            Telemetry(
                vehicle_id=str(row["vehicle_id"]),
                trip_id=str(row["trip_id"]),
                timestamp=ts,
                latitude=float(row["latitude"]),
                longitude=float(row["longitude"]),
                battery_percentage=float(row["battery_percentage"]),
                speed_kmh=float(row["speed_kmh"]),
                distance_travelled_km=float(row["distance_travelled_km"]),
                remaining_range_km=float(row["remaining_range_km"]),
                temperature_c=float(row["temperature_c"]),
                vehicle_weight_kg=float(row["vehicle_weight_kg"]),
                energy_consumption_kwh_per_km=float(row["energy_consumption_kwh_per_km"]),
                traffic_level=str(row["traffic_level"]),
                delivery_status=str(row["delivery_status"]),
                delivery_delay_minutes=float(row["delivery_delay_minutes"]),
                charging_status=str(row["charging_status"]),
                charging_station_id=cs_id,
                nearest_station_id=str(row["nearest_station_id"]),
                nearest_station_distance_km=float(row["nearest_station_distance_km"]),
                area=str(row["area"]),
            )
        )
        if cs_id:
            start_b = float(row["battery_percentage"])
            ev_objs.append(
                ChargingEvent(
                    vehicle_id=str(row["vehicle_id"]),
                    station_id=cs_id,
                    area=str(row["area"]),
                    start_time=ts,
                    end_time=ts + timedelta(minutes=34),
                    duration_minutes=34.0,
                    start_battery_pct=start_b,
                    end_battery_pct=86.0,
                    energy_delivered_kwh=round(max(12.0, (86.0 - start_b) * 0.92), 2),
                    wait_time_minutes=4.5,
                    peak_power_kw=150.0,
                )
            )

    db.bulk_save_objects(tel_objs)
    if ev_objs:
        db.bulk_save_objects(ev_objs)
    db.commit()
    return stats


if __name__ == "__main__":
    with SessionLocal() as session:
        result = seed_database(session)
        print("Seeded PostgreSQL database:", result)

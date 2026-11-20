from __future__ import annotations

from datetime import datetime
from typing import Optional
from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class Vehicle(Base):
    __tablename__ = "vehicles"

    vehicle_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    fleet_code: Mapped[str] = mapped_column(String(32), nullable=False)
    model_name: Mapped[str] = mapped_column(String(80), nullable=False)
    vehicle_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    battery_capacity_kwh: Mapped[float] = mapped_column(Float, nullable=False)
    max_payload_kg: Mapped[float] = mapped_column(Float, nullable=False)
    nominal_range_km: Mapped[float] = mapped_column(Float, nullable=False)
    home_area: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ChargingStation(Base):
    __tablename__ = "charging_stations"

    station_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    area: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    longitude: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    total_ports: Mapped[int] = mapped_column(Integer, nullable=False)
    available_ports: Mapped[int] = mapped_column(Integer, nullable=False)
    max_power_kw: Mapped[float] = mapped_column(Float, nullable=False)
    connector_type: Mapped[str] = mapped_column(String(40), nullable=False, default="CCS / NACS")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="operational")
    operator: Mapped[str] = mapped_column(String(80), nullable=False, default="VoltGrid Network")
    avg_utilization_pct: Mapped[float] = mapped_column(Float, nullable=False, default=65.0)
    price_per_kwh: Mapped[float] = mapped_column(Float, nullable=False, default=0.31)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Trip(Base):
    __tablename__ = "trips"

    trip_id: Mapped[str] = mapped_column(String(48), primary_key=True)
    vehicle_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("vehicles.vehicle_id", ondelete="CASCADE"), nullable=False, index=True
    )
    origin_area: Mapped[str] = mapped_column(String(80), nullable=False)
    destination_area: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    total_distance_km: Mapped[float] = mapped_column(Float, nullable=False)
    start_battery_pct: Mapped[float] = mapped_column(Float, nullable=False)
    end_battery_pct: Mapped[float] = mapped_column(Float, nullable=False)
    energy_used_kwh: Mapped[float] = mapped_column(Float, nullable=False)
    cargo_weight_kg: Mapped[float] = mapped_column(Float, nullable=False)
    delivery_status: Mapped[str] = mapped_column(String(32), nullable=False)
    delivery_delay_minutes: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Telemetry(Base):
    __tablename__ = "telemetry"
    __table_args__ = (
        Index("idx_telemetry_vehicle_time", "vehicle_id", "timestamp"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("vehicles.vehicle_id", ondelete="CASCADE"), nullable=False, index=True
    )
    trip_id: Mapped[str] = mapped_column(
        String(48), ForeignKey("trips.trip_id", ondelete="CASCADE"), nullable=False
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    longitude: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    battery_percentage: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    speed_kmh: Mapped[float] = mapped_column(Float, nullable=False)
    distance_travelled_km: Mapped[float] = mapped_column(Float, nullable=False)
    remaining_range_km: Mapped[float] = mapped_column(Float, nullable=False)
    temperature_c: Mapped[float] = mapped_column(Float, nullable=False)
    vehicle_weight_kg: Mapped[float] = mapped_column(Float, nullable=False)
    energy_consumption_kwh_per_km: Mapped[float] = mapped_column(Float, nullable=False)
    traffic_level: Mapped[str] = mapped_column(String(24), nullable=False)
    delivery_status: Mapped[str] = mapped_column(String(32), nullable=False)
    delivery_delay_minutes: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    charging_status: Mapped[str] = mapped_column(String(24), nullable=False)
    charging_station_id: Mapped[Optional[str]] = mapped_column(
        String(32), ForeignKey("charging_stations.station_id", ondelete="SET NULL"), nullable=True
    )
    nearest_station_id: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    nearest_station_distance_km: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    area: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    cluster_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cluster_category: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ChargingEvent(Base):
    __tablename__ = "charging_events"

    event_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("vehicles.vehicle_id", ondelete="CASCADE"), nullable=False, index=True
    )
    station_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("charging_stations.station_id", ondelete="CASCADE"), nullable=False, index=True
    )
    area: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    end_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_minutes: Mapped[float] = mapped_column(Float, nullable=False)
    start_battery_pct: Mapped[float] = mapped_column(Float, nullable=False)
    end_battery_pct: Mapped[float] = mapped_column(Float, nullable=False)
    energy_delivered_kwh: Mapped[float] = mapped_column(Float, nullable=False)
    wait_time_minutes: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    peak_power_kw: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MlPrediction(Base):
    __tablename__ = "ml_predictions"

    prediction_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vehicle_id: Mapped[str] = mapped_column(
        String(32), ForeignKey("vehicles.vehicle_id", ondelete="CASCADE"), nullable=False, index=True
    )
    telemetry_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("telemetry.id", ondelete="CASCADE"), nullable=False
    )
    area: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    predicted_range_km: Mapped[float] = mapped_column(Float, nullable=False)
    actual_range_km: Mapped[float] = mapped_column(Float, nullable=False)
    range_model_name: Mapped[str] = mapped_column(String(64), nullable=False)
    battery_risk: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    risk_probability: Mapped[float] = mapped_column(Float, nullable=False)
    risk_probabilities: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    predicted_charging_demand: Mapped[float] = mapped_column(Float, nullable=False)
    nearest_station_distance_km: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ChargingRecommendation(Base):
    __tablename__ = "charging_recommendations"

    recommendation_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rank: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    is_top3: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    area: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    corridor_label: Mapped[str] = mapped_column(String(120), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    battery_risk_score: Mapped[float] = mapped_column(Float, nullable=False)
    traffic_density_score: Mapped[float] = mapped_column(Float, nullable=False)
    delivery_delay_score: Mapped[float] = mapped_column(Float, nullable=False)
    charger_gap_score: Mapped[float] = mapped_column(Float, nullable=False)
    predicted_demand_score: Mapped[float] = mapped_column(Float, nullable=False)
    expected_ev_coverage: Mapped[int] = mapped_column(Integer, nullable=False)
    battery_risk_reduction_pct: Mapped[float] = mapped_column(Float, nullable=False)
    expected_delay_reduction: Mapped[float] = mapped_column(Float, nullable=False)
    expected_delay_reduction_pct: Mapped[float] = mapped_column(Float, nullable=False)
    nearest_existing_station_id: Mapped[str] = mapped_column(String(32), nullable=False)
    nearest_existing_station_distance: Mapped[float] = mapped_column(Float, nullable=False)
    predicted_daily_demand_kwh: Mapped[float] = mapped_column(Float, nullable=False)
    recommended_ports: Mapped[int] = mapped_column(Integer, nullable=False)
    recommended_power_kw: Mapped[float] = mapped_column(Float, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class HotspotCluster(Base):
    __tablename__ = "hotspot_clusters"

    cluster_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cluster_index: Mapped[int] = mapped_column(Integer, nullable=False)
    cluster_category: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    area: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    centroid_lat: Mapped[float] = mapped_column(Float, nullable=False)
    centroid_lon: Mapped[float] = mapped_column(Float, nullable=False)
    radius_km: Mapped[float] = mapped_column(Float, nullable=False)
    point_count: Mapped[int] = mapped_column(Integer, nullable=False)
    vehicle_count: Mapped[int] = mapped_column(Integer, nullable=False)
    avg_battery_pct: Mapped[float] = mapped_column(Float, nullable=False)
    critical_events: Mapped[int] = mapped_column(Integer, nullable=False)
    avg_energy_kwh_per_km: Mapped[float] = mapped_column(Float, nullable=False)
    avg_delay_minutes: Mapped[float] = mapped_column(Float, nullable=False)
    demand_intensity: Mapped[float] = mapped_column(Float, nullable=False)
    nearest_station_distance_km: Mapped[float] = mapped_column(Float, nullable=False)
    severity_score: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MlModelRun(Base):
    __tablename__ = "ml_model_runs"

    run_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_task: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    algorithm_name: Mapped[str] = mapped_column(String(80), nullable=False)
    is_selected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    train_samples: Mapped[int] = mapped_column(Integer, nullable=False)
    test_samples: Mapped[int] = mapped_column(Integer, nullable=False)
    metrics: Mapped[dict] = mapped_column(JSON, nullable=False)
    artifact_path: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_backend: Mapped[str] = mapped_column(String(32), nullable=False, default="local")
    trained_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

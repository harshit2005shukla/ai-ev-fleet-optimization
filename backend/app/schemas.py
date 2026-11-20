from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field


class GenerateDataRequest(BaseModel):
    records: int = Field(default=6000, ge=500, le=150000)
    vehicles: int = Field(default=60, ge=20, le=200)
    seed: int = Field(default=42, ge=1, le=999999)
    retrain: bool = Field(default=True)


class TrainModelsRequest(BaseModel):
    random_state: int = Field(default=42, ge=1, le=999999)


class LivePredictRequest(BaseModel):
    battery_percentage: float = Field(..., ge=1.0, le=100.0)
    speed_kmh: float = Field(..., ge=0.0, le=135.0)
    temperature_c: float = Field(..., ge=-20.0, le=50.0)
    vehicle_weight_kg: float = Field(..., ge=1200.0, le=9000.0)
    distance_travelled_km: float = Field(default=45.0, ge=0.0, le=600.0)
    energy_consumption_kwh_per_km: float = Field(..., ge=0.12, le=1.10)
    traffic_level: Literal["LOW", "MEDIUM", "HIGH", "SEVERE"]
    nearest_station_distance_km: float = Field(..., ge=0.1, le=35.0)
    area: Optional[str] = Field(default="Southeast Airport Freight")
    hour: Optional[int] = Field(default=15, ge=0, le=23)


class RecommendationOut(BaseModel):
    rank: int
    latitude: float
    longitude: float
    area: str
    corridor_label: str
    score: float
    expected_ev_coverage: int
    battery_risk_reduction_pct: float
    expected_delay_reduction: float
    expected_delay_reduction_pct: float
    nearest_existing_station_distance: float
    predicted_daily_demand_kwh: float
    rationale: str

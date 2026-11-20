import { sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { vehicles, mlModelRuns, chargingRecommendations } from "@/db/schema";
import { runTelemetryPipeline } from "./dataPipeline";
import { trainAllModelsAndClusters } from "./mlEngine";
import { runChargingStationOptimization } from "./optimizer";

const globalBootstrap = globalThis as typeof globalThis & {
  __evFleetInitPromise?: Promise<void>;
  __evFleetInitialized?: boolean;
};

const DDL_INIT_SQL = `
CREATE TABLE IF NOT EXISTS vehicles (
  vehicle_id VARCHAR(32) PRIMARY KEY,
  fleet_code VARCHAR(32) NOT NULL,
  model_name VARCHAR(80) NOT NULL,
  vehicle_type VARCHAR(50) NOT NULL,
  battery_capacity_kwh DOUBLE PRECISION NOT NULL,
  max_payload_kg DOUBLE PRECISION NOT NULL,
  nominal_range_km DOUBLE PRECISION NOT NULL,
  home_area VARCHAR(80) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehicles_area ON vehicles(home_area);
CREATE INDEX IF NOT EXISTS idx_vehicles_type ON vehicles(vehicle_type);
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);

CREATE TABLE IF NOT EXISTS charging_stations (
  station_id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  area VARCHAR(80) NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  total_ports INTEGER NOT NULL,
  available_ports INTEGER NOT NULL,
  max_power_kw DOUBLE PRECISION NOT NULL,
  connector_type VARCHAR(40) NOT NULL DEFAULT 'CCS2 / NACS',
  status VARCHAR(32) NOT NULL DEFAULT 'operational',
  operator VARCHAR(80) NOT NULL DEFAULT 'VoltGrid Network',
  avg_utilization_pct DOUBLE PRECISION NOT NULL DEFAULT 55,
  price_per_kwh DOUBLE PRECISION NOT NULL DEFAULT 0.32,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stations_area ON charging_stations(area);
CREATE INDEX IF NOT EXISTS idx_stations_lat ON charging_stations(latitude);
CREATE INDEX IF NOT EXISTS idx_stations_lon ON charging_stations(longitude);

CREATE TABLE IF NOT EXISTS trips (
  trip_id VARCHAR(48) PRIMARY KEY,
  vehicle_id VARCHAR(32) NOT NULL REFERENCES vehicles(vehicle_id) ON DELETE CASCADE,
  origin_area VARCHAR(80) NOT NULL,
  destination_area VARCHAR(80) NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  total_distance_km DOUBLE PRECISION NOT NULL,
  start_battery_pct DOUBLE PRECISION NOT NULL,
  end_battery_pct DOUBLE PRECISION NOT NULL,
  energy_used_kwh DOUBLE PRECISION NOT NULL,
  cargo_weight_kg DOUBLE PRECISION NOT NULL,
  delivery_status VARCHAR(32) NOT NULL,
  delivery_delay_minutes DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle_id ON trips(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_trips_start_time ON trips(start_time);
CREATE INDEX IF NOT EXISTS idx_trips_dest_area ON trips(destination_area);

CREATE TABLE IF NOT EXISTS telemetry (
  id SERIAL PRIMARY KEY,
  vehicle_id VARCHAR(32) NOT NULL REFERENCES vehicles(vehicle_id) ON DELETE CASCADE,
  trip_id VARCHAR(48) NOT NULL REFERENCES trips(trip_id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  battery_percentage DOUBLE PRECISION NOT NULL,
  speed_kmh DOUBLE PRECISION NOT NULL,
  distance_travelled_km DOUBLE PRECISION NOT NULL,
  remaining_range_km DOUBLE PRECISION NOT NULL,
  temperature_c DOUBLE PRECISION NOT NULL,
  vehicle_weight_kg DOUBLE PRECISION NOT NULL,
  energy_consumption_kwh_per_km DOUBLE PRECISION NOT NULL,
  traffic_level VARCHAR(24) NOT NULL,
  delivery_status VARCHAR(32) NOT NULL,
  delivery_delay_minutes DOUBLE PRECISION NOT NULL DEFAULT 0,
  charging_status VARCHAR(24) NOT NULL,
  charging_station_id VARCHAR(32) REFERENCES charging_stations(station_id) ON DELETE SET NULL,
  nearest_station_id VARCHAR(32),
  nearest_station_distance_km DOUBLE PRECISION NOT NULL DEFAULT 0,
  area VARCHAR(80) NOT NULL,
  cluster_id INTEGER,
  cluster_category VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_id ON telemetry(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp ON telemetry(timestamp);
CREATE INDEX IF NOT EXISTS idx_telemetry_latitude ON telemetry(latitude);
CREATE INDEX IF NOT EXISTS idx_telemetry_longitude ON telemetry(longitude);
CREATE INDEX IF NOT EXISTS idx_telemetry_battery ON telemetry(battery_percentage);
CREATE INDEX IF NOT EXISTS idx_telemetry_area ON telemetry(area);
CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_time ON telemetry(vehicle_id, timestamp);

CREATE TABLE IF NOT EXISTS charging_events (
  event_id SERIAL PRIMARY KEY,
  vehicle_id VARCHAR(32) NOT NULL REFERENCES vehicles(vehicle_id) ON DELETE CASCADE,
  station_id VARCHAR(32) NOT NULL REFERENCES charging_stations(station_id) ON DELETE CASCADE,
  area VARCHAR(80) NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_minutes DOUBLE PRECISION NOT NULL,
  start_battery_pct DOUBLE PRECISION NOT NULL,
  end_battery_pct DOUBLE PRECISION NOT NULL,
  energy_delivered_kwh DOUBLE PRECISION NOT NULL,
  wait_time_minutes DOUBLE PRECISION NOT NULL DEFAULT 0,
  peak_power_kw DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_charging_events_vehicle ON charging_events(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_charging_events_station ON charging_events(station_id);
CREATE INDEX IF NOT EXISTS idx_charging_events_area ON charging_events(area);
CREATE INDEX IF NOT EXISTS idx_charging_events_start ON charging_events(start_time);

CREATE TABLE IF NOT EXISTS ml_predictions (
  prediction_id SERIAL PRIMARY KEY,
  vehicle_id VARCHAR(32) NOT NULL REFERENCES vehicles(vehicle_id) ON DELETE CASCADE,
  telemetry_id INTEGER NOT NULL REFERENCES telemetry(id) ON DELETE CASCADE,
  area VARCHAR(80) NOT NULL,
  predicted_range_km DOUBLE PRECISION NOT NULL,
  actual_range_km DOUBLE PRECISION NOT NULL,
  range_model_name VARCHAR(64) NOT NULL,
  battery_risk VARCHAR(16) NOT NULL,
  risk_probability DOUBLE PRECISION NOT NULL,
  risk_probabilities JSONB,
  predicted_charging_demand DOUBLE PRECISION NOT NULL,
  nearest_station_distance_km DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_predictions_vehicle ON ml_predictions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_predictions_risk ON ml_predictions(battery_risk);
CREATE INDEX IF NOT EXISTS idx_predictions_area ON ml_predictions(area);

CREATE TABLE IF NOT EXISTS charging_recommendations (
  recommendation_id SERIAL PRIMARY KEY,
  rank INTEGER NOT NULL,
  is_top3 BOOLEAN NOT NULL DEFAULT FALSE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  area VARCHAR(80) NOT NULL,
  corridor_label VARCHAR(120) NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  battery_risk_score DOUBLE PRECISION NOT NULL,
  traffic_density_score DOUBLE PRECISION NOT NULL,
  delivery_delay_score DOUBLE PRECISION NOT NULL,
  charger_gap_score DOUBLE PRECISION NOT NULL,
  predicted_demand_score DOUBLE PRECISION NOT NULL,
  expected_ev_coverage INTEGER NOT NULL,
  battery_risk_reduction_pct DOUBLE PRECISION NOT NULL,
  expected_delay_reduction DOUBLE PRECISION NOT NULL,
  expected_delay_reduction_pct DOUBLE PRECISION NOT NULL,
  nearest_existing_station_id VARCHAR(32) NOT NULL,
  nearest_existing_station_distance DOUBLE PRECISION NOT NULL,
  predicted_daily_demand_kwh DOUBLE PRECISION NOT NULL,
  recommended_ports INTEGER NOT NULL,
  recommended_power_kw DOUBLE PRECISION NOT NULL,
  rationale TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recommendations_rank ON charging_recommendations(rank);
CREATE INDEX IF NOT EXISTS idx_recommendations_area ON charging_recommendations(area);

CREATE TABLE IF NOT EXISTS hotspot_clusters (
  cluster_id SERIAL PRIMARY KEY,
  cluster_index INTEGER NOT NULL,
  cluster_category VARCHAR(32) NOT NULL,
  area VARCHAR(80) NOT NULL,
  centroid_lat DOUBLE PRECISION NOT NULL,
  centroid_lon DOUBLE PRECISION NOT NULL,
  radius_km DOUBLE PRECISION NOT NULL,
  point_count INTEGER NOT NULL,
  vehicle_count INTEGER NOT NULL,
  avg_battery_pct DOUBLE PRECISION NOT NULL,
  critical_events INTEGER NOT NULL,
  avg_energy_kwh_per_km DOUBLE PRECISION NOT NULL,
  avg_delay_minutes DOUBLE PRECISION NOT NULL,
  demand_intensity DOUBLE PRECISION NOT NULL,
  nearest_station_distance_km DOUBLE PRECISION NOT NULL,
  severity_score DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hotspots_category ON hotspot_clusters(cluster_category);
CREATE INDEX IF NOT EXISTS idx_hotspots_area ON hotspot_clusters(area);

CREATE TABLE IF NOT EXISTS ml_model_runs (
  run_id SERIAL PRIMARY KEY,
  model_task VARCHAR(48) NOT NULL,
  algorithm_name VARCHAR(80) NOT NULL,
  is_selected BOOLEAN NOT NULL DEFAULT FALSE,
  train_samples INTEGER NOT NULL,
  test_samples INTEGER NOT NULL,
  metrics JSONB NOT NULL,
  artifact_path VARCHAR(255) NOT NULL,
  storage_backend VARCHAR(32) NOT NULL DEFAULT 'local',
  trained_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_model_runs_task ON ml_model_runs(model_task);
CREATE INDEX IF NOT EXISTS idx_model_runs_selected ON ml_model_runs(is_selected);
`;

async function initializeOnce() {
  await pool.query(DDL_INIT_SQL);

  const [{ count: vCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(vehicles);

  if (vCount === 0) {
    console.info("[Bootstrap] Seeding synthetic EV fleet telemetry pipeline...");
    await runTelemetryPipeline({ targetRecords: 4800, vehicleCount: 60, seed: 42, mode: "replace" });
  }

  const [{ count: mCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mlModelRuns);

  if (mCount === 0) {
    console.info("[Bootstrap] Training ML models and K-Means hotspot clusters...");
    await trainAllModelsAndClusters(42);
  }

  const [{ count: rCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chargingRecommendations);

  if (rCount === 0) {
    console.info("[Bootstrap] Running charging station location optimization...");
    await runChargingStationOptimization();
  }

  globalBootstrap.__evFleetInitialized = true;
}

/**
 * Ensures PostgreSQL tables, synthetic EV fleet dataset, trained ML models,
 * K-Means clusters, and charging recommendations exist before serving API requests.
 */
export async function ensureSystemReady(): Promise<void> {
  if (globalBootstrap.__evFleetInitialized) {
    return;
  }
  if (!globalBootstrap.__evFleetInitPromise) {
    globalBootstrap.__evFleetInitPromise = initializeOnce().catch((err) => {
      globalBootstrap.__evFleetInitPromise = undefined;
      throw err;
    });
  }
  await globalBootstrap.__evFleetInitPromise;
}

export function resetReadyFlag() {
  globalBootstrap.__evFleetInitialized = false;
  globalBootstrap.__evFleetInitPromise = undefined;
}

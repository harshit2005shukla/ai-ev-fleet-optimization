import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const vehicles = pgTable(
  "vehicles",
  {
    vehicleId: varchar("vehicle_id", { length: 32 }).primaryKey(),
    fleetCode: varchar("fleet_code", { length: 32 }).notNull(),
    modelName: varchar("model_name", { length: 80 }).notNull(),
    vehicleType: varchar("vehicle_type", { length: 50 }).notNull(),
    batteryCapacityKwh: doublePrecision("battery_capacity_kwh").notNull(),
    maxPayloadKg: doublePrecision("max_payload_kg").notNull(),
    nominalRangeKm: doublePrecision("nominal_range_km").notNull(),
    homeArea: varchar("home_area", { length: 80 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_vehicles_area").on(table.homeArea),
    index("idx_vehicles_type").on(table.vehicleType),
    index("idx_vehicles_status").on(table.status),
  ]
);

export const chargingStations = pgTable(
  "charging_stations",
  {
    stationId: varchar("station_id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    area: varchar("area", { length: 80 }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    totalPorts: integer("total_ports").notNull(),
    availablePorts: integer("available_ports").notNull(),
    maxPowerKw: doublePrecision("max_power_kw").notNull(),
    connectorType: varchar("connector_type", { length: 40 }).notNull().default("CCS2 / NACS"),
    status: varchar("status", { length: 32 }).notNull().default("operational"),
    operator: varchar("operator", { length: 80 }).notNull().default("VoltGrid Network"),
    avgUtilizationPct: doublePrecision("avg_utilization_pct").notNull().default(55),
    pricePerKwh: doublePrecision("price_per_kwh").notNull().default(0.32),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_stations_area").on(table.area),
    index("idx_stations_lat").on(table.latitude),
    index("idx_stations_lon").on(table.longitude),
  ]
);

export const trips = pgTable(
  "trips",
  {
    tripId: varchar("trip_id", { length: 48 }).primaryKey(),
    vehicleId: varchar("vehicle_id", { length: 32 })
      .notNull()
      .references(() => vehicles.vehicleId, { onDelete: "cascade" }),
    originArea: varchar("origin_area", { length: 80 }).notNull(),
    destinationArea: varchar("destination_area", { length: 80 }).notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    totalDistanceKm: doublePrecision("total_distance_km").notNull(),
    startBatteryPct: doublePrecision("start_battery_pct").notNull(),
    endBatteryPct: doublePrecision("end_battery_pct").notNull(),
    energyUsedKwh: doublePrecision("energy_used_kwh").notNull(),
    cargoWeightKg: doublePrecision("cargo_weight_kg").notNull(),
    deliveryStatus: varchar("delivery_status", { length: 32 }).notNull(),
    deliveryDelayMinutes: doublePrecision("delivery_delay_minutes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_trips_vehicle_id").on(table.vehicleId),
    index("idx_trips_start_time").on(table.startTime),
    index("idx_trips_dest_area").on(table.destinationArea),
  ]
);

export const telemetry = pgTable(
  "telemetry",
  {
    id: serial("id").primaryKey(),
    vehicleId: varchar("vehicle_id", { length: 32 })
      .notNull()
      .references(() => vehicles.vehicleId, { onDelete: "cascade" }),
    tripId: varchar("trip_id", { length: 48 })
      .notNull()
      .references(() => trips.tripId, { onDelete: "cascade" }),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    batteryPercentage: doublePrecision("battery_percentage").notNull(),
    speedKmh: doublePrecision("speed_kmh").notNull(),
    distanceTravelledKm: doublePrecision("distance_travelled_km").notNull(),
    remainingRangeKm: doublePrecision("remaining_range_km").notNull(),
    temperatureC: doublePrecision("temperature_c").notNull(),
    vehicleWeightKg: doublePrecision("vehicle_weight_kg").notNull(),
    energyConsumptionKwhPerKm: doublePrecision("energy_consumption_kwh_per_km").notNull(),
    trafficLevel: varchar("traffic_level", { length: 24 }).notNull(),
    deliveryStatus: varchar("delivery_status", { length: 32 }).notNull(),
    deliveryDelayMinutes: doublePrecision("delivery_delay_minutes").notNull().default(0),
    chargingStatus: varchar("charging_status", { length: 24 }).notNull(),
    chargingStationId: varchar("charging_station_id", { length: 32 }).references(
      () => chargingStations.stationId,
      { onDelete: "set null" }
    ),
    nearestStationId: varchar("nearest_station_id", { length: 32 }),
    nearestStationDistanceKm: doublePrecision("nearest_station_distance_km").notNull().default(0),
    area: varchar("area", { length: 80 }).notNull(),
    clusterId: integer("cluster_id"),
    clusterCategory: varchar("cluster_category", { length: 32 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_telemetry_vehicle_id").on(table.vehicleId),
    index("idx_telemetry_timestamp").on(table.timestamp),
    index("idx_telemetry_latitude").on(table.latitude),
    index("idx_telemetry_longitude").on(table.longitude),
    index("idx_telemetry_battery").on(table.batteryPercentage),
    index("idx_telemetry_area").on(table.area),
    index("idx_telemetry_vehicle_time").on(table.vehicleId, table.timestamp),
  ]
);

export const chargingEvents = pgTable(
  "charging_events",
  {
    eventId: serial("event_id").primaryKey(),
    vehicleId: varchar("vehicle_id", { length: 32 })
      .notNull()
      .references(() => vehicles.vehicleId, { onDelete: "cascade" }),
    stationId: varchar("station_id", { length: 32 })
      .notNull()
      .references(() => chargingStations.stationId, { onDelete: "cascade" }),
    area: varchar("area", { length: 80 }).notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    durationMinutes: doublePrecision("duration_minutes").notNull(),
    startBatteryPct: doublePrecision("start_battery_pct").notNull(),
    endBatteryPct: doublePrecision("end_battery_pct").notNull(),
    energyDeliveredKwh: doublePrecision("energy_delivered_kwh").notNull(),
    waitTimeMinutes: doublePrecision("wait_time_minutes").notNull().default(0),
    peakPowerKw: doublePrecision("peak_power_kw").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_charging_events_vehicle").on(table.vehicleId),
    index("idx_charging_events_station").on(table.stationId),
    index("idx_charging_events_area").on(table.area),
    index("idx_charging_events_start").on(table.startTime),
  ]
);

export const mlPredictions = pgTable(
  "ml_predictions",
  {
    predictionId: serial("prediction_id").primaryKey(),
    vehicleId: varchar("vehicle_id", { length: 32 })
      .notNull()
      .references(() => vehicles.vehicleId, { onDelete: "cascade" }),
    telemetryId: integer("telemetry_id")
      .notNull()
      .references(() => telemetry.id, { onDelete: "cascade" }),
    area: varchar("area", { length: 80 }).notNull(),
    predictedRangeKm: doublePrecision("predicted_range_km").notNull(),
    actualRangeKm: doublePrecision("actual_range_km").notNull(),
    rangeModelName: varchar("range_model_name", { length: 64 }).notNull(),
    batteryRisk: varchar("battery_risk", { length: 16 }).notNull(),
    riskProbability: doublePrecision("risk_probability").notNull(),
    riskProbabilities: jsonb("risk_probabilities").$type<{
      LOW: number;
      MEDIUM: number;
      HIGH: number;
    }>(),
    predictedChargingDemand: doublePrecision("predicted_charging_demand").notNull(),
    nearestStationDistanceKm: doublePrecision("nearest_station_distance_km").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_predictions_vehicle").on(table.vehicleId),
    index("idx_predictions_risk").on(table.batteryRisk),
    index("idx_predictions_area").on(table.area),
  ]
);

export const chargingRecommendations = pgTable(
  "charging_recommendations",
  {
    recommendationId: serial("recommendation_id").primaryKey(),
    rank: integer("rank").notNull(),
    isTop3: boolean("is_top3").notNull().default(false),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    area: varchar("area", { length: 80 }).notNull(),
    corridorLabel: varchar("corridor_label", { length: 120 }).notNull(),
    score: doublePrecision("score").notNull(),
    batteryRiskScore: doublePrecision("battery_risk_score").notNull(),
    trafficDensityScore: doublePrecision("traffic_density_score").notNull(),
    deliveryDelayScore: doublePrecision("delivery_delay_score").notNull(),
    chargerGapScore: doublePrecision("charger_gap_score").notNull(),
    predictedDemandScore: doublePrecision("predicted_demand_score").notNull(),
    expectedEvCoverage: integer("expected_ev_coverage").notNull(),
    batteryRiskReductionPct: doublePrecision("battery_risk_reduction_pct").notNull(),
    expectedDelayReduction: doublePrecision("expected_delay_reduction").notNull(),
    expectedDelayReductionPct: doublePrecision("expected_delay_reduction_pct").notNull(),
    nearestExistingStationId: varchar("nearest_existing_station_id", { length: 32 }).notNull(),
    nearestExistingStationDistance: doublePrecision("nearest_existing_station_distance").notNull(),
    predictedDailyDemandKwh: doublePrecision("predicted_daily_demand_kwh").notNull(),
    recommendedPorts: integer("recommended_ports").notNull(),
    recommendedPowerKw: doublePrecision("recommended_power_kw").notNull(),
    rationale: text("rationale").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_recommendations_rank").on(table.rank),
    index("idx_recommendations_area").on(table.area),
  ]
);

export const hotspotClusters = pgTable(
  "hotspot_clusters",
  {
    clusterId: serial("cluster_id").primaryKey(),
    clusterIndex: integer("cluster_index").notNull(),
    clusterCategory: varchar("cluster_category", { length: 32 }).notNull(),
    area: varchar("area", { length: 80 }).notNull(),
    centroidLat: doublePrecision("centroid_lat").notNull(),
    centroidLon: doublePrecision("centroid_lon").notNull(),
    radiusKm: doublePrecision("radius_km").notNull(),
    pointCount: integer("point_count").notNull(),
    vehicleCount: integer("vehicle_count").notNull(),
    avgBatteryPct: doublePrecision("avg_battery_pct").notNull(),
    criticalEvents: integer("critical_events").notNull(),
    avgEnergyKwhPerKm: doublePrecision("avg_energy_kwh_per_km").notNull(),
    avgDelayMinutes: doublePrecision("avg_delay_minutes").notNull(),
    demandIntensity: doublePrecision("demand_intensity").notNull(),
    nearestStationDistanceKm: doublePrecision("nearest_station_distance_km").notNull(),
    severityScore: doublePrecision("severity_score").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_hotspots_category").on(table.clusterCategory),
    index("idx_hotspots_area").on(table.area),
  ]
);

export const mlModelRuns = pgTable(
  "ml_model_runs",
  {
    runId: serial("run_id").primaryKey(),
    modelTask: varchar("model_task", { length: 48 }).notNull(),
    algorithmName: varchar("algorithm_name", { length: 80 }).notNull(),
    isSelected: boolean("is_selected").notNull().default(false),
    trainSamples: integer("train_samples").notNull(),
    testSamples: integer("test_samples").notNull(),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
    artifactPath: varchar("artifact_path", { length: 255 }).notNull(),
    storageBackend: varchar("storage_backend", { length: 32 }).notNull().default("local"),
    trainedAt: timestamp("trained_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("idx_model_runs_task").on(table.modelTask),
    index("idx_model_runs_selected").on(table.isSelected),
  ]
);

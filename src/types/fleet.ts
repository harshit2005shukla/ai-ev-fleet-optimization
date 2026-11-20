export type PageKey =
  | "overview"
  | "fleet"
  | "predictions"
  | "infrastructure"
  | "optimization"
  | "analytics";

export type BatteryRiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface FleetSummaryResponse {
  kpis: {
    totalEvs: number;
    activeEvs: number;
    chargingEvs: number;
    avgBatteryPct: number;
    criticalBatteryVehicles: number;
    avgRemainingRangeKm: number;
    avgDeliveryDelayMin: number;
    avgDistanceToChargerKm: number;
    predictedChargingDemandKwh: number;
    totalTelemetryRecords: number;
    totalTrips: number;
    totalChargingStations: number;
    totalChargingEvents: number;
  };
  riskBreakdown: Record<BatteryRiskLevel, number>;
  batteryDistribution: Array<{ band: string; vehicles: number }>;
  dailyTrends: Array<{
    day: string;
    avgBatteryPct: number;
    avgRangeKm: number;
    avgDelayMin: number;
    fleetHealthScore: number;
    criticalEvents: number;
    activeVehicles: number;
    chargingSessions: number;
    chargingEnergyKwh: number;
    predictedDemandKwh: number;
    avgWaitMin: number;
  }>;
  priorityWatchlist: Array<{
    vehicle_id: string;
    vehicle_type: string;
    area: string;
    battery_percentage: number;
    predicted_range_km: number;
    nearest_station_distance_km: number;
    delivery_delay_minutes: number;
    battery_risk: BatteryRiskLevel;
  }>;
  storage: {
    mode: "s3" | "local";
    bucket: string | null;
    region: string | null;
    localModelPath: string;
  };
}

export interface VehicleListItem {
  vehicle_id: string;
  fleet_code: string;
  model_name: string;
  vehicle_type: string;
  battery_capacity_kwh: number;
  max_payload_kg: number;
  nominal_range_km: number;
  home_area: string;
  status: string;
  last_seen: string;
  latitude: number;
  longitude: number;
  battery_percentage: number;
  speed_kmh: number;
  distance_travelled_km: number;
  remaining_range_km: number;
  temperature_c: number;
  vehicle_weight_kg: number;
  energy_consumption_kwh_per_km: number;
  traffic_level: string;
  delivery_status: string;
  delivery_delay_minutes: number;
  charging_status: string;
  nearest_station_id: string;
  nearest_station_distance_km: number;
  area: string;
  predicted_range_km: number;
  battery_risk: BatteryRiskLevel;
  risk_probability: number;
  range_model_name: string | null;
}

export interface VehiclesResponse {
  items: VehicleListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filterOptions: {
    areas: string[];
    vehicleTypes: string[];
    riskLevels: BatteryRiskLevel[];
  };
}

export interface VehicleDetailResponse {
  vehicle: {
    vehicleId: string;
    fleetCode: string;
    modelName: string;
    vehicleType: string;
    batteryCapacityKwh: number;
    maxPayloadKg: number;
    nominalRangeKm: number;
    homeArea: string;
    status: string;
  };
  latestTelemetry: {
    timestamp: string;
    latitude: number;
    longitude: number;
    batteryPercentage: number;
    speedKmh: number;
    distanceTravelledKm: number;
    remainingRangeKm: number;
    temperatureC: number;
    vehicleWeightKg: number;
    energyConsumptionKwhPerKm: number;
    trafficLevel: string;
    deliveryStatus: string;
    deliveryDelayMinutes: number;
    chargingStatus: string;
    nearestStationId: string | null;
    nearestStationDistanceKm: number;
    area: string;
  } | null;
  prediction: {
    predictedRangeKm: number;
    actualRangeKm: number;
    rangeModelName: string;
    batteryRisk: BatteryRiskLevel;
    riskProbability: number;
    riskProbabilities: Record<BatteryRiskLevel, number> | null;
    predictedChargingDemand: number;
    nearestStationDistanceKm: number;
  } | null;
  nearestStation: {
    stationId: string;
    name: string;
    area: string;
    maxPowerKw: number;
    availablePorts: number;
    totalPorts: number;
  } | null;
  telemetryHistory: Array<{
    id: number;
    timestamp: string;
    batteryPercentage: number;
    remainingRangeKm: number;
    speedKmh: number;
    temperatureC: number;
    energyConsumptionKwhPerKm: number;
    deliveryDelayMinutes: number;
    area: string;
  }>;
  recentTrips: Array<{
    tripId: string;
    originArea: string;
    destinationArea: string;
    startTime: string;
    totalDistanceKm: number;
    startBatteryPct: number;
    endBatteryPct: number;
    energyUsedKwh: number;
    deliveryStatus: string;
    deliveryDelayMinutes: number;
  }>;
}

export interface RangeModelItem {
  algorithmName: string;
  isSelected: boolean;
  trainSamples: number;
  testSamples: number;
  mae: number;
  rmse: number;
  r2: number;
  cvR2Mean: number;
  cvR2Std: number;
  featureImportances: Record<string, number>;
  samplePredictions: Array<{ actual: number; predicted: number; residual: number }>;
  artifactPath: string;
  storageBackend: string;
  trainedAt: string;
}

export interface RangePredictionsResponse {
  selectedModel: RangeModelItem | null;
  modelComparison: RangeModelItem[];
  vehiclePredictions: Array<{
    vehicle_id: string;
    model_name: string;
    vehicle_type: string;
    area: string;
    battery_percentage: number;
    speed_kmh: number;
    temperature_c: number;
    vehicle_weight_kg: number;
    energy_consumption_kwh_per_km: number;
    traffic_level: string;
    actual_range_km: number;
    predicted_range_km: number;
    error_km: number;
    range_model_name: string;
    battery_risk: BatteryRiskLevel;
  }>;
}

export interface BatteryRiskResponse {
  model: {
    algorithmName: string;
    trainSamples: number;
    testSamples: number;
    artifactPath: string;
    storageBackend: string;
    trainedAt: string;
    metrics: {
      accuracy: number;
      macroPrecision: number;
      macroRecall: number;
      macroF1: number;
      weightedF1: number;
      perClass: Record<
        BatteryRiskLevel,
        { precision: number; recall: number; f1: number; support: number }
      >;
      confusionMatrix: {
        labels: BatteryRiskLevel[];
        matrix: number[][];
      };
      featureImportances: Record<string, number>;
    };
  } | null;
  summary: Record<BatteryRiskLevel, number>;
  areaRiskBreakdown: Array<{
    area: string;
    high_risk: number;
    medium_risk: number;
    low_risk: number;
    total: number;
  }>;
  predictions: Array<{
    vehicle_id: string;
    model_name: string;
    vehicle_type: string;
    area: string;
    battery_percentage: number;
    remaining_range_km: number;
    predicted_range_km: number;
    speed_kmh: number;
    temperature_c: number;
    traffic_level: string;
    energy_consumption_kwh_per_km: number;
    nearest_station_distance_km: number;
    battery_risk: BatteryRiskLevel;
    risk_probability: number;
    risk_probabilities: Record<BatteryRiskLevel, number> | null;
  }>;
}

export interface ChargingDemandResponse {
  model: {
    algorithmName: string;
    trainSamples: number;
    testSamples: number;
    mae: number;
    rmse: number;
    r2: number;
    cvR2Mean: number;
    featureImportances: Record<string, number>;
    artifactPath: string;
    storageBackend: string;
    trainedAt: string;
  } | null;
  totalPredictedDailyDemandKwh: number;
  areaForecasts: Array<{
    area: string;
    predictedDailyDemandKwh: number;
    peakHourDemandKwh: number;
    activeVehicles: number;
    avgBatteryPct: number;
    hourly: Array<{ hour: number; predictedDemandKwh: number }>;
  }>;
  hourlyForecast: Array<{
    hour: number;
    hourLabel: string;
    predictedDemandKwh: number;
    historicalSessions: number;
    historicalAvgDailyKwh: number;
    avgWaitMinutes: number;
  }>;
}

export interface ChargingStationItem {
  station_id: string;
  name: string;
  area: string;
  latitude: number;
  longitude: number;
  total_ports: number;
  available_ports: number;
  max_power_kw: number;
  connector_type: string;
  status: string;
  operator: string;
  avg_utilization_pct: number;
  price_per_kwh: number;
  total_sessions: number;
  total_energy_kwh: number;
  avg_wait_minutes: number;
  avg_duration_minutes: number;
}

export interface ChargingStationsResponse {
  stations: ChargingStationItem[];
  liveFleetPositions: Array<{
    vehicle_id: string;
    vehicle_type: string;
    area: string;
    latitude: number;
    longitude: number;
    battery_percentage: number;
    speed_kmh: number;
    predicted_range_km: number;
    battery_risk: BatteryRiskLevel;
    nearest_station_id: string;
    nearest_station_distance_km: number;
  }>;
  summary: {
    totalStations: number;
    totalPorts: number;
    availablePorts: number;
    avgUtilizationPct: number;
    avgEvDistanceToStationKm: number;
  };
}

export interface HotspotItem {
  clusterId: number;
  clusterIndex: number;
  clusterCategory: "BATTERY_RISK" | "HIGH_DEMAND" | "HIGH_ACTIVITY";
  area: string;
  centroidLat: number;
  centroidLon: number;
  radiusKm: number;
  pointCount: number;
  vehicleCount: number;
  avgBatteryPct: number;
  criticalEvents: number;
  avgEnergyKwhPerKm: number;
  avgDelayMinutes: number;
  demandIntensity: number;
  nearestStationDistanceKm: number;
  severityScore: number;
}

export interface HotspotsResponse {
  hotspots: HotspotItem[];
  grouped: {
    batteryRisk: HotspotItem[];
    highDemand: HotspotItem[];
    highActivity: HotspotItem[];
  };
}

export interface RecommendationItem {
  recommendation_id?: number;
  rank: number;
  is_top3?: boolean;
  latitude: number;
  longitude: number;
  area: string;
  corridor_label: string;
  score: number;
  sub_scores: {
    battery_risk_demand: number;
    ev_traffic_density: number;
    delivery_delay: number;
    charger_gap_distance: number;
    predicted_demand: number;
  };
  expected_ev_coverage: number;
  battery_risk_reduction_pct: number;
  expected_delay_reduction: number;
  expected_delay_reduction_pct: number;
  nearest_existing_station_id: string;
  nearest_existing_station_distance: number;
  predicted_daily_demand_kwh: number;
  recommended_ports: number;
  recommended_power_kw: number;
  rationale: string;
}

export interface RecommendationsResponse {
  recommendations: RecommendationItem[];
  methodology: {
    algorithm: string;
    catchmentRadiusKm: number;
    minSeparationBetweenNewStationsKm: number;
    minSeparationFromExistingKm: number;
    weights: {
      battery_risk_demand: number;
      ev_traffic_density: number;
      delivery_delay: number;
      distance_from_existing_chargers: number;
      predicted_charging_demand: number;
    };
  };
}

export interface DeliveryImpactResponse {
  evaluatedTelemetryRecords: number;
  existingStationsCount: number;
  recommendedStationsAdded: number;
  totalInfrastructureAfter: number;
  before: {
    avgDeliveryDelayMinutes: number;
    criticalBatteryEvents: number;
    avgDistanceToStationKm: number;
    fleetWithin3_5KmPct: number;
  };
  after: {
    avgDeliveryDelayMinutes: number;
    criticalBatteryEvents: number;
    avgDistanceToStationKm: number;
    fleetWithin3_5KmPct: number;
  };
  impact: {
    deliveryDelayReductionPct: number;
    deliveryDelaySavedMinutesPerStop: number;
    totalWeeklyDelayHoursSaved: number;
    criticalEventsPrevented: number;
    criticalEventsReductionPct: number;
    avgDistanceReductionKm: number;
    distanceReductionPct: number;
    coverageImprovementPct: number;
  };
  areaComparison: Array<{
    area: string;
    records: number;
    beforeAvgDelayMinutes: number;
    afterAvgDelayMinutes: number;
    delayReductionPct: number;
    beforeAvgDistanceKm: number;
    afterAvgDistanceKm: number;
    beforeCriticalEvents: number;
    afterCriticalEvents: number;
  }>;
}

export interface AnalyticsResponse {
  evsByArea: Array<{
    area: string;
    active_evs: number;
    avg_battery_pct: number;
    avg_range_km: number;
    avg_delay_min: number;
    avg_charger_dist_km: number;
    high_risk_evs: number;
    medium_risk_evs: number;
    low_risk_evs: number;
  }>;
  batteryTrends: Array<{
    day: string;
    avg_battery_pct: number;
    p15_battery_pct: number;
    avg_range_km: number;
    avg_consumption_kwh_km: number;
  }>;
  temperatureVsRange: Array<{
    temp_bin: number;
    temp_label: string;
    samples: number;
    avg_range_km: number;
    normalized_80pct_range_km: number;
    avg_energy_kwh_km: number;
  }>;
  speedVsEnergy: Array<{
    speed_bin: number;
    speed_label: string;
    samples: number;
    avg_energy_kwh_km: number;
    avg_range_km: number;
  }>;
  trafficVsDelay: Array<{
    traffic_level: string;
    records: number;
    avg_delay_min: number;
    p90_delay_min: number;
    avg_speed_kmh: number;
    avg_energy_kwh_km: number;
  }>;
  chargingDemandByHour: Array<{
    hour: number;
    hourLabel: string;
    predictedDemandKwh: number;
    lowBatteryEvents: number;
    avgBatteryPct: number;
    avgDelayMin: number;
  }>;
  vehicleEfficiency: Array<{
    vehicle_type: string;
    fleet_count: number;
    battery_capacity_kwh: number;
    avg_weight_kg: number;
    avg_kwh_per_km: number;
    km_per_kwh: number;
    avg_range_km: number;
    avg_delay_min: number;
  }>;
}

export interface MapFocusTarget {
  latitude: number;
  longitude: number;
  label: string;
  rank?: number;
  vehicleId?: string;
}

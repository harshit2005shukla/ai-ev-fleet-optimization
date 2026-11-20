import { db } from "@/db";
import {
  vehicles,
  chargingStations,
  trips,
  telemetry,
  chargingEvents,
  mlPredictions,
  chargingRecommendations,
  hotspotClusters,
  mlModelRuns,
} from "@/db/schema";
import {
  FLEET_AREAS,
  INITIAL_CHARGING_STATIONS,
  findNearestStation,
  isValidGps,
} from "./geo";
import { saveArtifact } from "./s3";

export class SeededRng {
  private state: number;

  constructor(seed = 42) {
    this.state = seed >>> 0;
  }

  next(): number {
    // Mulberry32 deterministic PRNG
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  normal(mean = 0, std = 1): number {
    const u1 = Math.max(1e-7, this.next());
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * std;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

interface VehicleSpec {
  vehicleType: string;
  models: string[];
  batteryKwh: number;
  curbWeightKg: number;
  maxPayloadKg: number;
  nominalRangeKm: number;
  baseConsumption: number;
  hvacSensitivity: number;
}

const VEHICLE_SPECS: VehicleSpec[] = [
  {
    vehicleType: "Compact Cargo Van",
    models: ["Rivian EDV-500", "Ford E-Transit Custom"],
    batteryKwh: 72,
    curbWeightKg: 2150,
    maxPayloadKg: 1050,
    nominalRangeKm: 305,
    baseConsumption: 0.21,
    hvacSensitivity: 1.0,
  },
  {
    vehicleType: "Mid-Size Step Van",
    models: ["Rivian EDV-700", "BrightDrop Zevo 600"],
    batteryKwh: 96,
    curbWeightKg: 2850,
    maxPayloadKg: 1650,
    nominalRangeKm: 335,
    baseConsumption: 0.255,
    hvacSensitivity: 1.08,
  },
  {
    vehicleType: "Refrigerated EV Van",
    models: ["Mercedes eSprinter ColdChain", "Ford E-Transit Reefer"],
    batteryKwh: 104,
    curbWeightKg: 3100,
    maxPayloadKg: 1500,
    nominalRangeKm: 295,
    baseConsumption: 0.295,
    hvacSensitivity: 1.32,
  },
  {
    vehicleType: "Heavy Box Truck",
    models: ["Volvo FL Electric", "Freightliner eM2"],
    batteryKwh: 142,
    curbWeightKg: 4300,
    maxPayloadKg: 3100,
    nominalRangeKm: 350,
    baseConsumption: 0.355,
    hvacSensitivity: 1.15,
  },
];

export const TRAFFIC_LEVELS = ["LOW", "MEDIUM", "HIGH", "SEVERE"] as const;
export type TrafficLevel = (typeof TRAFFIC_LEVELS)[number];

export const TRAFFIC_ENCODED: Record<string, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  SEVERE: 3,
};

interface RawTelemetryRecord {
  dedupeKey: string;
  vehicleId: string;
  tripId: string;
  timestamp: string | Date;
  latitude: number;
  longitude: number;
  batteryPercentage: number | null;
  speedKmh: number | null;
  distanceTravelledKm: number;
  remainingRangeKm: number;
  temperatureC: number | null;
  vehicleWeightKg: number;
  energyConsumptionKwhPerKm: number;
  trafficLevel: string;
  deliveryStatus: string;
  deliveryDelayMinutes: number;
  chargingStatus: string;
  chargingStationId: string | null;
  area: string;
  batteryCapacityKwh: number;
}

export interface PipelineStats {
  rawRecordsGenerated: number;
  cleanedRecordsInserted: number;
  vehiclesCount: number;
  tripsCount: number;
  chargingStationsCount: number;
  chargingEventsCount: number;
  cleaningSummary: {
    missingValuesImputed: number;
    duplicatesRemoved: number;
    invalidGpsFiltered: number;
    invalidBatteryHandled: number;
    invalidSpeedFiltered: number;
    outliersCapped: number;
    timestampsNormalized: number;
  };
  storage: {
    rawArtifact: string;
    processedArtifact: string;
    backend: "s3" | "local";
  };
  durationMs: number;
}

export function computeThermalPenaltyFactor(tempC: number, sensitivity = 1.0): number {
  // Optimal EV battery thermal band is ~20-23°C
  if (tempC < 18) {
    const diff = 18 - tempC;
    return 1 + Math.min(0.42, 0.0095 * diff + 0.00028 * diff * diff) * sensitivity;
  }
  if (tempC > 25) {
    const diff = tempC - 25;
    return 1 + Math.min(0.36, 0.0085 * diff + 0.00032 * diff * diff) * sensitivity;
  }
  return 1.0;
}

export function computePhysicsConsumption(params: {
  baseConsumption: number;
  speedKmh: number;
  vehicleWeightKg: number;
  temperatureC: number;
  trafficLevel: string;
  elevationFactor?: number;
  hvacSensitivity?: number;
}): number {
  const {
    baseConsumption,
    speedKmh,
    vehicleWeightKg,
    temperatureC,
    trafficLevel,
    elevationFactor = 1.03,
    hvacSensitivity = 1.05,
  } = params;

  // Aerodynamic drag penalty grows quadratically above 42 km/h; very low crawl also loses auxiliary efficiency
  const speedDelta = Math.max(0, speedKmh - 40);
  const aeroFactor = 1 + 0.000095 * speedDelta * speedDelta + (speedKmh < 18 && speedKmh > 0 ? 0.06 : 0);

  // Rolling resistance increases with vehicle mass relative to 2,200 kg baseline
  const weightFactor = 1 + Math.max(0, vehicleWeightKg - 2100) * 0.000088;

  // Thermal conditioning load
  const thermalFactor = computeThermalPenaltyFactor(temperatureC, hvacSensitivity);

  // Stop-and-go congestion inefficiency
  const trafficMultiplier =
    trafficLevel === "SEVERE"
      ? 1.24
      : trafficLevel === "HIGH"
        ? 1.14
        : trafficLevel === "MEDIUM"
          ? 1.06
          : 1.0;

  return baseConsumption * aeroFactor * weightFactor * thermalFactor * trafficMultiplier * elevationFactor;
}

async function batchInsert<T extends Record<string, unknown>>(
  table: Parameters<typeof db.insert>[0],
  rows: T[],
  chunkSize = 500
) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const slice = rows.slice(i, i + chunkSize);
    if (slice.length > 0) {
      await db.insert(table).values(slice);
    }
  }
}

/**
 * End-to-end EV Telemetry Data Pipeline:
 * Synthetic Data -> Validation -> Cleaning -> Feature Engineering -> PostgreSQL (+ optional S3)
 */
export async function runTelemetryPipeline(options?: {
  targetRecords?: number;
  vehicleCount?: number;
  seed?: number;
  mode?: "replace" | "append";
}): Promise<PipelineStats> {
  const t0 = Date.now();
  const targetRecords = Math.max(600, Math.min(25000, options?.targetRecords ?? 4800));
  const vehicleCount = Math.max(24, Math.min(120, options?.vehicleCount ?? 60));
  const seed = options?.seed ?? 42;
  const mode = options?.mode ?? "replace";
  const rng = new SeededRng(seed);

  if (mode === "replace") {
    await db.delete(mlPredictions);
    await db.delete(chargingRecommendations);
    await db.delete(hotspotClusters);
    await db.delete(mlModelRuns);
    await db.delete(chargingEvents);
    await db.delete(telemetry);
    await db.delete(trips);
    await db.delete(vehicles);
    await db.delete(chargingStations);
  }

  // 1. Ensure charging stations exist
  const existingStations = await db.select().from(chargingStations);
  const stationList =
    existingStations.length > 0 ? existingStations : INITIAL_CHARGING_STATIONS;

  if (existingStations.length === 0) {
    await db.insert(chargingStations).values(INITIAL_CHARGING_STATIONS);
  }

  // 2. Ensure fleet vehicles exist
  let fleetVehicles = await db.select().from(vehicles);
  const vehicleSpecMap = new Map<string, VehicleSpec>();

  if (fleetVehicles.length === 0) {
    // Weight area assignment by freight intensity so underserved logistics areas have strong commercial presence
    const weightedAreas: typeof FLEET_AREAS = [];
    for (const a of FLEET_AREAS) {
      const copies = a.freightIntensity > 1.15 ? 3 : 2;
      for (let c = 0; c < copies; c++) weightedAreas.push(a);
    }

    const newVehicles = [];
    for (let i = 1; i <= vehicleCount; i++) {
      const vehicleId = `EV-${String(100 + i)}`;
      const spec = VEHICLE_SPECS[(i - 1) % VEHICLE_SPECS.length];
      const modelName = spec.models[rng.int(0, spec.models.length - 1)];
      const homeArea = weightedAreas[(i - 1) % weightedAreas.length].name;
      const statusRoll = rng.next();
      const status =
        statusRoll < 0.74
          ? "active"
          : statusRoll < 0.89
            ? "charging"
            : statusRoll < 0.97
              ? "idle"
              : "maintenance";

      vehicleSpecMap.set(vehicleId, spec);
      newVehicles.push({
        vehicleId,
        fleetCode: `ATX-FLT-${String(i).padStart(3, "0")}`,
        modelName,
        vehicleType: spec.vehicleType,
        batteryCapacityKwh: spec.batteryKwh,
        maxPayloadKg: spec.maxPayloadKg,
        nominalRangeKm: spec.nominalRangeKm,
        homeArea,
        status,
      });
    }
    await batchInsert(vehicles, newVehicles, 200);
    fleetVehicles = await db.select().from(vehicles);
  }

  for (const v of fleetVehicles) {
    if (!vehicleSpecMap.has(v.vehicleId)) {
      const found =
        VEHICLE_SPECS.find((s) => s.vehicleType === v.vehicleType) ?? VEHICLE_SPECS[0];
      vehicleSpecMap.set(v.vehicleId, found);
    }
  }

  // 3. Generate realistic trips, raw telemetry records, and charging events spanning the past 7 days
  const now = new Date();
  // Round to nearest 15 minutes for crisp analytics buckets
  const anchorMs = Math.floor(now.getTime() / (15 * 60 * 1000)) * (15 * 60 * 1000);
  const windowDays = 7;
  const windowStartMs = anchorMs - windowDays * 24 * 3600 * 1000;

  const pointsPerTrip = 8;
  const totalTrips = Math.max(fleetVehicles.length * 2, Math.ceil(targetRecords / pointsPerTrip));
  const tripPrefix = mode === "append" ? `TRP-${seed}-` : "TRP-";

  const tripRows: Array<typeof trips.$inferInsert> = [];
  const chargingEventRows: Array<typeof chargingEvents.$inferInsert> = [];
  const rawRecords: RawTelemetryRecord[] = [];

  // Weighted destination picker favoring high-demand commercial hubs
  const destPool: (typeof FLEET_AREAS)[number][] = [];
  for (const area of FLEET_AREAS) {
    const weight = Math.round(area.freightIntensity * 10);
    for (let w = 0; w < weight; w++) destPool.push(area);
  }

  for (let t = 0; t < totalTrips; t++) {
    const vehicle = fleetVehicles[t % fleetVehicles.length];
    const spec = vehicleSpecMap.get(vehicle.vehicleId)!;
    const originAreaObj =
      FLEET_AREAS.find((a) => a.name === vehicle.homeArea) ?? rng.pick(FLEET_AREAS);
    // 62% operate within home freight zone, 38% cross-metro route
    const destAreaObj = rng.next() < 0.62 ? originAreaObj : rng.pick(destPool);

    const tripId = `${tripPrefix}${String(10001 + t)}`;
    // Spread trips smoothly across all 7 days with realistic daytime commercial peak (06:00-21:00)
    const dayOffset = t % windowDays;
    const isPeakShift = rng.next() < 0.78;
    const hourOfDay = isPeakShift ? rng.int(6, 20) : rng.int(0, 23);
    const minute = rng.int(0, 59);
    const tripStartMs =
      windowStartMs +
      dayOffset * 24 * 3600 * 1000 +
      hourOfDay * 3600 * 1000 +
      minute * 60 * 1000;

    // Ensure final trip for each vehicle is near "now" so live fleet monitoring is fresh
    const isRecentTrip = t >= totalTrips - fleetVehicles.length;
    const effectiveStartMs = isRecentTrip
      ? anchorMs - rng.int(55, 165) * 60 * 1000
      : Math.min(tripStartMs, anchorMs - 90 * 60 * 1000);

    // Underserved depots start some secondary shifts with lower state-of-charge due to charger scarcity
    const homeNearest = findNearestStation(
      destAreaObj.centerLat,
      destAreaObj.centerLon,
      stationList
    );
    const isUnderserved = homeNearest.distanceKm > 4.2;

    let batteryPct = isUnderserved
      ? rng.range(42, 92)
      : rng.range(56, 98);
    if (rng.next() < (isUnderserved ? 0.3 : 0.11)) {
      // Multi-drop afternoon route entering low SoC territory
      batteryPct = rng.range(24, 48);
    }
    if (isRecentTrip) {
      // Stagger live vehicles authentically across freshly dispatched, mid-route, and low-SoC states
      const shiftBand = t % 6;
      if (shiftBand === 0) batteryPct = rng.range(88, 99);
      else if (shiftBand === 1) batteryPct = rng.range(74, 89);
      else if (shiftBand === 2) batteryPct = rng.range(58, 75);
      else if (shiftBand === 3) batteryPct = rng.range(44, 60);
      else if (shiftBand === 4) batteryPct = isUnderserved ? rng.range(24, 38) : rng.range(34, 48);
      else batteryPct = isUnderserved ? rng.range(14, 26) : rng.range(20, 34);
    }

    const startBatteryPct = Number(batteryPct.toFixed(1));
    const payloadRatio = Math.min(
      1,
      Math.max(0.15, rng.range(0.22, 0.96) * (destAreaObj.freightIntensity / 1.05))
    );
    const cargoWeightKg = Number((spec.maxPayloadKg * payloadRatio).toFixed(0));
    const vehicleWeightKg = Number((spec.curbWeightKg + cargoWeightKg).toFixed(0));

    let cumDistanceKm = 0;
    let cumEnergyKwh = 0;
    let finalDelayMin = 0;
    let finalStatus = "IN_TRANSIT";
    let stepMs = effectiveStartMs;
    const tripPoints = isRecentTrip ? rng.int(2, 5) : pointsPerTrip;

    for (let p = 0; p < tripPoints; p++) {
      const progress = (p + 1) / tripPoints;
      stepMs += rng.int(10, 18) * 60 * 1000;
      const pointDate = new Date(Math.min(stepMs, anchorMs));
      const hr = pointDate.getUTCHours();

      // Interpolate GPS from origin to destination logistics cluster with street-level jitter
      const baseLat =
        originAreaObj.centerLat +
        (destAreaObj.centerLat - originAreaObj.centerLat) * progress;
      const baseLon =
        originAreaObj.centerLon +
        (destAreaObj.centerLon - originAreaObj.centerLon) * progress;
      const lat = Number(
        (baseLat + rng.normal(0, destAreaObj.spreadLat * 0.58)).toFixed(6)
      );
      const lon = Number(
        (baseLon + rng.normal(0, destAreaObj.spreadLon * 0.58)).toFixed(6)
      );

      const activeAreaObj = progress < 0.4 ? originAreaObj : destAreaObj;

      // Realistic diurnal + seasonal weather sweep (-2°C cold snap mornings to 40°C hot afternoons)
      const dayWeatherShift = ((dayOffset * 7) % 5 - 2) * 5.8; // -11.6 to +11.6
      const diurnalCurve = Math.sin(((hr - 5) / 24) * 2 * Math.PI) * 8.5;
      const temperatureC = Number(
        Math.max(-3, Math.min(41.5, 21 + dayWeatherShift + diurnalCurve + rng.normal(0, 2.4))).toFixed(1)
      );

      // Rush-hour traffic distribution (07-09 and 16-19 peaks)
      const isRushHour = (hr >= 7 && hr <= 9) || (hr >= 16 && hr <= 19);
      const trafficScore =
        activeAreaObj.baseTraffic * 0.65 +
        (isRushHour ? 0.34 : 0.05) +
        rng.range(-0.18, 0.22);
      const trafficLevel: TrafficLevel =
        trafficScore >= 0.88
          ? "SEVERE"
          : trafficScore >= 0.68
            ? "HIGH"
            : trafficScore >= 0.45
              ? "MEDIUM"
              : "LOW";

      // Speed inversely affected by traffic congestion; higher on suburban freight highways
      const isHighwayZone =
        activeAreaObj.name === "Southeast Airport Freight" ||
        activeAreaObj.name === "Round Rock North Depot" ||
        activeAreaObj.name === "Pflugerville Industrial";
      const targetSpeed =
        trafficLevel === "SEVERE"
          ? rng.range(14, 34)
          : trafficLevel === "HIGH"
            ? rng.range(26, 54)
            : trafficLevel === "MEDIUM"
              ? rng.range(42, isHighwayZone ? 84 : 68)
              : rng.range(55, isHighwayZone ? 104 : 82);
      const speedKmh = Number(Math.max(0, targetSpeed).toFixed(1));

      const segmentDistKm = Number(
        Math.max(1.8, (speedKmh * rng.range(0.16, 0.28))).toFixed(2)
      );
      cumDistanceKm = Number((cumDistanceKm + segmentDistKm).toFixed(2));

      // Physics-coupled energy consumption (kWh/km)
      const rawConsumption = computePhysicsConsumption({
        baseConsumption: spec.baseConsumption,
        speedKmh,
        vehicleWeightKg,
        temperatureC,
        trafficLevel,
        elevationFactor: activeAreaObj.elevationFactor,
        hvacSensitivity: spec.hvacSensitivity,
      });
      const energyConsumption = Number(
        Math.max(0.14, rawConsumption * (1 + rng.normal(0, 0.045))).toFixed(4)
      );

      const segEnergyKwh = segmentDistKm * energyConsumption;
      cumEnergyKwh += segEnergyKwh;
      const pctDrop = (segEnergyKwh / spec.batteryKwh) * 100;
      batteryPct = Math.max(4.2, batteryPct - pctDrop);
      const cleanBatteryPct = Number(batteryPct.toFixed(1));

      // Remaining range driven by battery energy left and effective consumption + mild BMS noise
      const remainingKwh = (cleanBatteryPct / 100) * spec.batteryKwh;
      const expectedRange = remainingKwh / energyConsumption;
      const remainingRangeKm = Number(
        Math.max(6, expectedRange * (1 + rng.normal(0, 0.038))).toFixed(1)
      );

      // Nearest station determines charging detour delay when battery gets low
      const nearest = findNearestStation(lat, lon, stationList);
      let chargingStatus = "DISCHARGING";
      let chargingStationId: string | null = null;

      // Traffic delay + low-battery detour/queue delay
      const trafficDelay =
        trafficLevel === "SEVERE"
          ? rng.range(9, 21)
          : trafficLevel === "HIGH"
            ? rng.range(4.5, 12.5)
            : trafficLevel === "MEDIUM"
              ? rng.range(1, 5.5)
              : rng.range(0, 2.2);

      let batteryDetourDelay = 0;
      if (cleanBatteryPct < 28) {
        const urgency = (28 - cleanBatteryPct) / 22; // 0 to ~1.1
        // Charging detour time scales directly with round-trip distance to nearest charger + congestion wait
        const detourTravelMin = (nearest.distanceKm * 2 / 36) * 60;
        const chargerQueueMin =
          (nearest.station.avgUtilizationPct > 80 ? 8.5 : 3.2) * urgency;
        batteryDetourDelay = detourTravelMin * (0.55 + 0.55 * urgency) + chargerQueueMin;
      }

      const deliveryDelayMinutes = Number(
        Math.max(0, trafficDelay + batteryDetourDelay + rng.normal(0, 0.8)).toFixed(1)
      );

      // Trigger charging session at end of low-battery trip
      if (p === tripPoints - 1 && !isRecentTrip && cleanBatteryPct < 34 && rng.next() < 0.72) {
        chargingStatus = "CHARGING";
        chargingStationId = nearest.station.stationId;
        const targetEndPct = Number(rng.range(78, 94).toFixed(1));
        const deliveredKwh = Number(
          (((targetEndPct - cleanBatteryPct) / 100) * spec.batteryKwh).toFixed(2)
        );
        const effectivePowerKw = Math.min(nearest.station.maxPowerKw * 0.72, spec.batteryKwh * 1.15);
        const durationMin = Number(
          Math.max(14, (deliveredKwh / effectivePowerKw) * 60).toFixed(1)
        );
        const waitMin = Number(
          Math.max(
            0,
            ((nearest.station.avgUtilizationPct - 55) / 35) * rng.range(3, 14) +
              (nearest.distanceKm > 4.5 ? rng.range(4, 10) : 0)
          ).toFixed(1)
        );
        chargingEventRows.push({
          vehicleId: vehicle.vehicleId,
          stationId: nearest.station.stationId,
          area: activeAreaObj.name,
          startTime: pointDate,
          endTime: new Date(pointDate.getTime() + durationMin * 60 * 1000),
          durationMinutes: durationMin,
          startBatteryPct: cleanBatteryPct,
          endBatteryPct: targetEndPct,
          energyDeliveredKwh: deliveredKwh,
          waitTimeMinutes: waitMin,
          peakPowerKw: Number(Math.min(nearest.station.maxPowerKw, effectivePowerKw * 1.25).toFixed(1)),
        });
      }

      const deliveryStatus =
        deliveryDelayMinutes > 14
          ? "DELAYED"
          : p === tripPoints - 1 && !isRecentTrip
            ? "DELIVERED"
            : "ON_TIME";

      finalDelayMin = deliveryDelayMinutes;
      finalStatus = deliveryStatus;

      const record: RawTelemetryRecord = {
        dedupeKey: `${vehicle.vehicleId}|${pointDate.toISOString()}`,
        vehicleId: vehicle.vehicleId,
        tripId,
        timestamp: p % 17 === 0 ? pointDate.toUTCString() : pointDate, // mix string timestamps to exercise normalizer
        latitude: lat,
        longitude: lon,
        batteryPercentage: cleanBatteryPct,
        speedKmh,
        distanceTravelledKm: cumDistanceKm,
        remainingRangeKm,
        temperatureC,
        vehicleWeightKg,
        energyConsumptionKwhPerKm: energyConsumption,
        trafficLevel,
        deliveryStatus,
        deliveryDelayMinutes,
        chargingStatus,
        chargingStationId,
        area: activeAreaObj.name,
        batteryCapacityKwh: spec.batteryKwh,
      };

      // Inject ~2.4% realistic raw telemetry noise/faults so the data cleaning pipeline genuinely cleans them
      const anomalyRoll = rng.next();
      if (!isRecentTrip && anomalyRoll < 0.024) {
        if (anomalyRoll < 0.005) {
          record.temperatureC = null; // missing sensor reading
        } else if (anomalyRoll < 0.009) {
          record.speedKmh = null; // missing speed packet
        } else if (anomalyRoll < 0.013) {
          record.latitude = 0.0; // dropped GPS lock (0,0)
          record.longitude = 0.0;
        } else if (anomalyRoll < 0.017) {
          record.batteryPercentage = anomalyRoll < 0.015 ? 108.5 : -4.2; // invalid BMS spike
        } else if (anomalyRoll < 0.020) {
          record.speedKmh = 189.4; // impossible speed glitch
        } else if (anomalyRoll < 0.022) {
          record.energyConsumptionKwhPerKm = 2.45; // outlier consumption spike
        } else {
          rawRecords.push({ ...record }); // duplicate packet
        }
      }

      rawRecords.push(record);
    }

    tripRows.push({
      tripId,
      vehicleId: vehicle.vehicleId,
      originArea: originAreaObj.name,
      destinationArea: destAreaObj.name,
      startTime: new Date(effectiveStartMs),
      endTime: new Date(Math.min(stepMs, anchorMs)),
      totalDistanceKm: Number(cumDistanceKm.toFixed(2)),
      startBatteryPct,
      endBatteryPct: Number(batteryPct.toFixed(1)),
      energyUsedKwh: Number(cumEnergyKwh.toFixed(2)),
      cargoWeightKg,
      deliveryStatus: finalStatus,
      deliveryDelayMinutes: finalDelayMin,
    });
  }

  // 4. Validation, Data Cleaning & Feature Engineering Stage
  const cleaningSummary = {
    missingValuesImputed: 0,
    duplicatesRemoved: 0,
    invalidGpsFiltered: 0,
    invalidBatteryHandled: 0,
    invalidSpeedFiltered: 0,
    outliersCapped: 0,
    timestampsNormalized: 0,
  };

  // Compute robust medians for missing value imputation
  const validTemps = rawRecords
    .map((r) => r.temperatureC)
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);
  const medianTemp = validTemps[Math.floor(validTemps.length / 2)] ?? 22.0;

  const validSpeeds = rawRecords
    .map((r) => r.speedKmh)
    .filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0 && v <= 135)
    .sort((a, b) => a - b);
  const medianSpeed = validSpeeds[Math.floor(validSpeeds.length / 2)] ?? 48.0;

  const seenKeys = new Set<string>();
  const cleanedTelemetryRows: Array<typeof telemetry.$inferInsert> = [];

  for (const raw of rawRecords) {
    // Timestamp normalization to UTC Date
    let normalizedTs: Date;
    if (typeof raw.timestamp === "string") {
      cleaningSummary.timestampsNormalized++;
      normalizedTs = new Date(raw.timestamp);
    } else {
      normalizedTs = raw.timestamp;
    }
    if (Number.isNaN(normalizedTs.getTime())) continue;

    // Duplicate removal on (vehicle_id, normalized_timestamp)
    const key = `${raw.vehicleId}|${normalizedTs.toISOString()}`;
    if (seenKeys.has(key)) {
      cleaningSummary.duplicatesRemoved++;
      continue;
    }
    seenKeys.add(key);

    // Invalid GPS filtering
    if (!isValidGps(raw.latitude, raw.longitude)) {
      cleaningSummary.invalidGpsFiltered++;
      continue;
    }

    // Missing value imputation
    let temperatureC = raw.temperatureC;
    if (temperatureC === null || !Number.isFinite(temperatureC)) {
      temperatureC = medianTemp;
      cleaningSummary.missingValuesImputed++;
    }

    let speedKmh = raw.speedKmh;
    if (speedKmh === null || !Number.isFinite(speedKmh)) {
      speedKmh = medianSpeed;
      cleaningSummary.missingValuesImputed++;
    }

    // Invalid speed filtering (commercial EV fleet governor max 135 km/h)
    if (speedKmh < 0 || speedKmh > 135) {
      cleaningSummary.invalidSpeedFiltered++;
      continue;
    }

    // Invalid battery filtering / bounds enforcement
    let batteryPct = raw.batteryPercentage;
    if (batteryPct === null || !Number.isFinite(batteryPct) || batteryPct < 0) {
      cleaningSummary.invalidBatteryHandled++;
      continue;
    }
    if (batteryPct > 100) {
      batteryPct = 100;
      cleaningSummary.invalidBatteryHandled++;
    }

    // IQR / domain outlier capping on energy consumption & temperature
    let energyConsumption = raw.energyConsumptionKwhPerKm;
    if (energyConsumption < 0.12 || energyConsumption > 0.95) {
      energyConsumption = Math.max(0.12, Math.min(0.95, energyConsumption));
      cleaningSummary.outliersCapped++;
    }
    if (temperatureC < -15 || temperatureC > 48) {
      temperatureC = Math.max(-15, Math.min(48, temperatureC));
      cleaningSummary.outliersCapped++;
    }

    // Geospatial Feature Engineering: compute exact Haversine distance to nearest existing charger
    const nearest = findNearestStation(raw.latitude, raw.longitude, stationList);

    cleanedTelemetryRows.push({
      vehicleId: raw.vehicleId,
      tripId: raw.tripId,
      timestamp: normalizedTs,
      latitude: raw.latitude,
      longitude: raw.longitude,
      batteryPercentage: batteryPct,
      speedKmh,
      distanceTravelledKm: Math.max(0, raw.distanceTravelledKm),
      remainingRangeKm: Math.max(0, raw.remainingRangeKm),
      temperatureC,
      vehicleWeightKg: raw.vehicleWeightKg,
      energyConsumptionKwhPerKm: energyConsumption,
      trafficLevel: TRAFFIC_LEVELS.includes(raw.trafficLevel as TrafficLevel)
        ? raw.trafficLevel
        : "MEDIUM",
      deliveryStatus: raw.deliveryStatus,
      deliveryDelayMinutes: Math.max(0, raw.deliveryDelayMinutes),
      chargingStatus: raw.chargingStatus,
      chargingStationId: raw.chargingStationId,
      nearestStationId: nearest.station.stationId,
      nearestStationDistanceKm: nearest.distanceKm,
      area: raw.area,
    });
  }

  // 5. Persist trips, cleaned telemetry, and charging events to PostgreSQL
  await batchInsert(trips, tripRows, 300);
  await batchInsert(telemetry, cleanedTelemetryRows, 400);
  await batchInsert(chargingEvents, chargingEventRows, 300);

  // 6. Export raw sample & processed dataset manifest to AWS S3 (or local `data/raw` & `data/processed`)
  const rawStorage = await saveArtifact(
    "raw",
    "latest_raw_telemetry_sample.json",
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalRawRecords: rawRecords.length,
        seed,
        sample: rawRecords.slice(0, 150),
      },
      null,
      2
    )
  );

  const processedStorage = await saveArtifact(
    "processed",
    "latest_cleaned_telemetry_summary.json",
    JSON.stringify(
      {
        processedAt: new Date().toISOString(),
        cleanedRecords: cleanedTelemetryRows.length,
        cleaningSummary,
        sample: cleanedTelemetryRows.slice(0, 150),
      },
      null,
      2
    )
  );

  return {
    rawRecordsGenerated: rawRecords.length,
    cleanedRecordsInserted: cleanedTelemetryRows.length,
    vehiclesCount: fleetVehicles.length,
    tripsCount: tripRows.length,
    chargingStationsCount: stationList.length,
    chargingEventsCount: chargingEventRows.length,
    cleaningSummary,
    storage: {
      rawArtifact: rawStorage.uri,
      processedArtifact: processedStorage.uri,
      backend: processedStorage.backend,
    },
    durationMs: Date.now() - t0,
  };
}

/**
 * Computes the ground-truth operational battery risk class (LOW / MEDIUM / HIGH)
 * from multi-factor state-of-charge, remaining range, distance to charger, and energy drain.
 */
export function deriveBatteryRiskLabel(row: {
  batteryPercentage: number;
  remainingRangeKm: number;
  speedKmh: number;
  temperatureC: number;
  trafficLevel: string;
  nearestStationDistanceKm: number;
  energyConsumptionKwhPerKm: number;
}): "LOW" | "MEDIUM" | "HIGH" {
  // Composite physical vulnerability index
  let riskPoints = 0;
  if (row.batteryPercentage < 20) riskPoints += 4.2;
  else if (row.batteryPercentage < 28) riskPoints += 2.9;
  else if (row.batteryPercentage < 38) riskPoints += 1.6;
  else if (row.batteryPercentage < 48) riskPoints += 0.6;

  if (row.remainingRangeKm < 45) riskPoints += 2.6;
  else if (row.remainingRangeKm < 80) riskPoints += 1.4;
  else if (row.remainingRangeKm < 115) riskPoints += 0.5;

  if (row.nearestStationDistanceKm > 5.5) riskPoints += 1.5;
  else if (row.nearestStationDistanceKm > 3.5) riskPoints += 0.85;

  if (row.energyConsumptionKwhPerKm > 0.42) riskPoints += 0.9;
  else if (row.energyConsumptionKwhPerKm > 0.34) riskPoints += 0.45;

  if (row.trafficLevel === "SEVERE") riskPoints += 0.75;
  else if (row.trafficLevel === "HIGH") riskPoints += 0.4;

  if (row.temperatureC < 5 || row.temperatureC > 34) riskPoints += 0.5;
  if (row.speedKmh > 85) riskPoints += 0.35;

  if (riskPoints >= 5.2) return "HIGH";
  if (riskPoints >= 2.8) return "MEDIUM";
  return "LOW";
}

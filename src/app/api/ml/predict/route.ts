import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureSystemReady } from "@/lib/bootstrap";
import { predictLiveTelemetry } from "@/lib/mlEngine";
import { jsonOk, jsonError, getCorsHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";

const PredictInputSchema = z.object({
  battery_percentage: z.number().min(1).max(100),
  speed_kmh: z.number().min(0).max(135),
  temperature_c: z.number().min(-20).max(50),
  vehicle_weight_kg: z.number().min(1200).max(9000),
  distance_travelled_km: z.number().min(0).max(600).default(45),
  energy_consumption_kwh_per_km: z.number().min(0.12).max(1.1),
  traffic_level: z.enum(["LOW", "MEDIUM", "HIGH", "SEVERE"]),
  nearest_station_distance_km: z.number().min(0.1).max(35),
  area: z.string().min(2).max(80).optional(),
  hour: z.number().int().min(0).max(23).optional(),
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: getCorsHeaders() });
}

export async function POST(request: NextRequest) {
  try {
    await ensureSystemReady();
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return jsonError("Invalid JSON request body", 400);
    }

    const parsed = PredictInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonError("Invalid prediction parameters", 422, parsed.error.flatten());
    }

    const d = parsed.data;
    const result = await predictLiveTelemetry({
      batteryPercentage: d.battery_percentage,
      speedKmh: d.speed_kmh,
      temperatureC: d.temperature_c,
      vehicleWeightKg: d.vehicle_weight_kg,
      distanceTravelledKm: d.distance_travelled_km,
      energyConsumptionKwhPerKm: d.energy_consumption_kwh_per_km,
      trafficLevel: d.traffic_level,
      nearestStationDistanceKm: d.nearest_station_distance_km,
      area: d.area,
      hour: d.hour,
    });

    return jsonOk(result);
  } catch (error) {
    console.error("[POST /api/ml/predict] Error:", error);
    return jsonError("Failed to run ML inference", 500);
  }
}

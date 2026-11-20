import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  vehicles,
  telemetry,
  trips,
  mlPredictions,
  chargingStations,
  chargingEvents,
} from "@/db/schema";
import { ensureSystemReady } from "@/lib/bootstrap";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ vehicle_id: string }> }
) {
  try {
    await ensureSystemReady();
    const { vehicle_id } = await context.params;
    const vehicleId = vehicle_id?.trim().toUpperCase();

    if (!vehicleId || !/^[A-Z0-9-]{3,32}$/.test(vehicleId)) {
      return jsonError("Invalid vehicle_id format", 400);
    }

    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.vehicleId, vehicleId))
      .limit(1);

    if (!vehicle) {
      return jsonError(`Vehicle ${vehicleId} not found`, 404);
    }

    const [recentTelemetry, recentTrips, predictionRows, recentCharging] =
      await Promise.all([
        db
          .select()
          .from(telemetry)
          .where(eq(telemetry.vehicleId, vehicleId))
          .orderBy(desc(telemetry.timestamp))
          .limit(32),
        db
          .select()
          .from(trips)
          .where(eq(trips.vehicleId, vehicleId))
          .orderBy(desc(trips.startTime))
          .limit(8),
        db
          .select()
          .from(mlPredictions)
          .where(eq(mlPredictions.vehicleId, vehicleId))
          .limit(1),
        db
          .select()
          .from(chargingEvents)
          .where(eq(chargingEvents.vehicleId, vehicleId))
          .orderBy(desc(chargingEvents.startTime))
          .limit(6),
      ]);

    const latest = recentTelemetry[0] ?? null;
    let nearestStation = null;
    if (latest?.nearestStationId) {
      const [st] = await db
        .select()
        .from(chargingStations)
        .where(eq(chargingStations.stationId, latest.nearestStationId))
        .limit(1);
      nearestStation = st ?? null;
    }

    return jsonOk({
      vehicle,
      latestTelemetry: latest,
      prediction: predictionRows[0] ?? null,
      nearestStation,
      telemetryHistory: [...recentTelemetry].reverse(),
      recentTrips,
      recentChargingEvents: recentCharging,
    });
  } catch (error) {
    console.error("[GET /api/vehicles/[vehicle_id]] Error:", error);
    return jsonError("Failed to retrieve vehicle details", 500);
  }
}

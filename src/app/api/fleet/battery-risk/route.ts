import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { mlModelRuns } from "@/db/schema";
import { ensureSystemReady } from "@/lib/bootstrap";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await ensureSystemReady();
    const riskFilter = request.nextUrl.searchParams.get("risk")?.trim().toUpperCase();

    const [modelRuns, predRes, areaRiskRes] = await Promise.all([
      db
        .select()
        .from(mlModelRuns)
        .where(eq(mlModelRuns.modelTask, "battery_risk")),
      pool.query(
        `SELECT
           p.vehicle_id,
           v.model_name,
           v.vehicle_type,
           p.area,
           t.battery_percentage,
           t.remaining_range_km,
           p.predicted_range_km,
           t.speed_kmh,
           t.temperature_c,
           t.traffic_level,
           t.energy_consumption_kwh_per_km,
           p.nearest_station_distance_km,
           p.battery_risk,
           p.risk_probability,
           p.risk_probabilities
         FROM ml_predictions p
         JOIN telemetry t ON t.id = p.telemetry_id
         JOIN vehicles v ON v.vehicle_id = p.vehicle_id
         ${
           riskFilter && ["LOW", "MEDIUM", "HIGH"].includes(riskFilter)
             ? `WHERE p.battery_risk = $1`
             : ""
         }
         ORDER BY
           CASE p.battery_risk WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
           t.battery_percentage ASC`,
        riskFilter && ["LOW", "MEDIUM", "HIGH"].includes(riskFilter)
          ? [riskFilter]
          : []
      ),
      pool.query(`
        SELECT
          area,
          COUNT(*) FILTER (WHERE battery_risk = 'HIGH')::int AS high_risk,
          COUNT(*) FILTER (WHERE battery_risk = 'MEDIUM')::int AS medium_risk,
          COUNT(*) FILTER (WHERE battery_risk = 'LOW')::int AS low_risk,
          COUNT(*)::int AS total
        FROM ml_predictions
        GROUP BY area
        ORDER BY high_risk DESC, medium_risk DESC
      `),
    ]);

    const activeRun = modelRuns[0] ?? null;
    const summary = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const row of predRes.rows) {
      const k = row.battery_risk as "HIGH" | "MEDIUM" | "LOW";
      if (k in summary) summary[k]++;
    }

    return jsonOk({
      model: activeRun
        ? {
            algorithmName: activeRun.algorithmName,
            trainSamples: activeRun.trainSamples,
            testSamples: activeRun.testSamples,
            artifactPath: activeRun.artifactPath,
            storageBackend: activeRun.storageBackend,
            trainedAt: activeRun.trainedAt,
            metrics: activeRun.metrics,
          }
        : null,
      summary,
      areaRiskBreakdown: areaRiskRes.rows,
      predictions: predRes.rows,
    });
  } catch (error) {
    console.error("[GET /api/fleet/battery-risk] Error:", error);
    return jsonError("Failed to load battery risk predictions", 500);
  }
}

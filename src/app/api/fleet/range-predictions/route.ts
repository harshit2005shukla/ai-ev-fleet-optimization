import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { mlModelRuns } from "@/db/schema";
import { ensureSystemReady } from "@/lib/bootstrap";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSystemReady();

    const [runs, predictionsRes] = await Promise.all([
      db
        .select()
        .from(mlModelRuns)
        .where(eq(mlModelRuns.modelTask, "range_prediction")),
      pool.query(`
        SELECT
          p.vehicle_id,
          v.model_name,
          v.vehicle_type,
          p.area,
          t.battery_percentage,
          t.speed_kmh,
          t.temperature_c,
          t.vehicle_weight_kg,
          t.energy_consumption_kwh_per_km,
          t.traffic_level,
          p.actual_range_km,
          p.predicted_range_km,
          ROUND((p.predicted_range_km - p.actual_range_km)::numeric, 1)::float AS error_km,
          p.range_model_name,
          p.battery_risk
        FROM ml_predictions p
        JOIN telemetry t ON t.id = p.telemetry_id
        JOIN vehicles v ON v.vehicle_id = p.vehicle_id
        ORDER BY p.predicted_range_km ASC
      `),
    ]);

    const sortedModels = runs
      .map((r) => {
        const m = r.metrics as {
          mae: number;
          rmse: number;
          r2: number;
          cvR2Mean?: number;
          cvR2Std?: number;
          featureImportances?: Record<string, number>;
          samplePredictions?: Array<{ actual: number; predicted: number; residual: number }>;
        };
        return {
          algorithmName: r.algorithmName,
          isSelected: r.isSelected,
          trainSamples: r.trainSamples,
          testSamples: r.testSamples,
          mae: m.mae,
          rmse: m.rmse,
          r2: m.r2,
          cvR2Mean: m.cvR2Mean ?? m.r2,
          cvR2Std: m.cvR2Std ?? 0,
          featureImportances: m.featureImportances ?? {},
          samplePredictions: m.samplePredictions ?? [],
          artifactPath: r.artifactPath,
          storageBackend: r.storageBackend,
          trainedAt: r.trainedAt,
        };
      })
      .sort((a, b) => a.rmse - b.rmse);

    const selectedModel = sortedModels.find((m) => m.isSelected) ?? sortedModels[0] ?? null;

    return jsonOk({
      selectedModel,
      modelComparison: sortedModels,
      vehiclePredictions: predictionsRes.rows,
    });
  } catch (error) {
    console.error("[GET /api/fleet/range-predictions] Error:", error);
    return jsonError("Failed to fetch range predictions", 500);
  }
}

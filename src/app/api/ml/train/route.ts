import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureSystemReady } from "@/lib/bootstrap";
import { trainAllModelsAndClusters } from "@/lib/mlEngine";
import { runChargingStationOptimization, calculateDeliveryDelayImpact } from "@/lib/optimizer";
import { jsonOk, jsonError, getCorsHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";

const TrainSchema = z.object({
  random_state: z.number().int().min(1).max(999999).optional().default(42),
});

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: getCorsHeaders() });
}

export async function POST(request: NextRequest) {
  try {
    await ensureSystemReady();
    let rawBody: unknown = {};
    try {
      const text = await request.text();
      if (text.trim()) rawBody = JSON.parse(text);
    } catch {
      return jsonError("Invalid JSON request body", 400);
    }

    const parsed = TrainSchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonError("Validation failed", 422, parsed.error.flatten());
    }

    const training = await trainAllModelsAndClusters(parsed.data.random_state);
    const optimization = await runChargingStationOptimization();
    const delayImpact = await calculateDeliveryDelayImpact();

    return jsonOk({
      status: "trained",
      message: `Trained 3 range regressors (selected ${training.selectedRangeModel}), Battery Risk classifier, Charging Demand regressor, K-Means hotspots, and recomputed Top 3 station recommendations.`,
      training,
      top3Recommendations: optimization.top3.map((r) => ({
        rank: r.rank,
        area: r.area,
        corridor_label: r.corridorLabel,
        score: r.score,
        latitude: r.latitude,
        longitude: r.longitude,
      })),
      deliveryDelayReductionPct: delayImpact?.impact.deliveryDelayReductionPct ?? 0,
    });
  } catch (error) {
    console.error("[POST /api/ml/train] Error:", error);
    return jsonError(
      error instanceof Error ? error.message : "Failed to train ML models",
      500
    );
  }
}

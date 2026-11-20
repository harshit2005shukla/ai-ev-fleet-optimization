import { NextRequest } from "next/server";
import { z } from "zod";
import { ensureSystemReady } from "@/lib/bootstrap";
import { runTelemetryPipeline } from "@/lib/dataPipeline";
import { trainAllModelsAndClusters } from "@/lib/mlEngine";
import { runChargingStationOptimization, calculateDeliveryDelayImpact } from "@/lib/optimizer";
import { jsonOk, jsonError, getCorsHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";

const GenerateSchema = z.object({
  records: z.number().int().min(600).max(25000).optional().default(4800),
  vehicles: z.number().int().min(24).max(120).optional().default(60),
  seed: z.number().int().min(1).max(999999).optional().default(42),
  mode: z.enum(["replace", "append"]).optional().default("replace"),
  retrain: z.boolean().optional().default(true),
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

    const parsed = GenerateSchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonError("Validation failed", 422, parsed.error.flatten());
    }

    const { records, vehicles, seed, mode, retrain } = parsed.data;
    const pipeline = await runTelemetryPipeline({
      targetRecords: records,
      vehicleCount: vehicles,
      seed,
      mode,
    });

    let training = null;
    let delayImpact = null;
    if (retrain) {
      training = await trainAllModelsAndClusters(seed);
      await runChargingStationOptimization();
      delayImpact = await calculateDeliveryDelayImpact();
    }

    return jsonOk(
      {
        status: "completed",
        message: `Generated ${pipeline.rawRecordsGenerated.toLocaleString()} raw telemetry records, inserted ${pipeline.cleanedRecordsInserted.toLocaleString()} validated records into PostgreSQL, and updated ML analytics.`,
        pipeline,
        training,
        deliveryDelayReductionPct: delayImpact?.impact.deliveryDelayReductionPct ?? null,
      },
      201
    );
  } catch (error) {
    console.error("[POST /api/data/generate] Error:", error);
    return jsonError(
      error instanceof Error ? error.message : "Failed to run telemetry pipeline",
      500
    );
  }
}

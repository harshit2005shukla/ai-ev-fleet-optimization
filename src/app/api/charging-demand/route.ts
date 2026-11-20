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
    const areaFilter = request.nextUrl.searchParams.get("area")?.trim();

    const [runs, histByHourRes] = await Promise.all([
      db
        .select()
        .from(mlModelRuns)
        .where(eq(mlModelRuns.modelTask, "charging_demand")),
      pool.query(`
        SELECT
          EXTRACT(HOUR FROM start_time)::int AS hour,
          COUNT(*)::int AS historical_sessions,
          ROUND(SUM(energy_delivered_kwh)::numeric, 1)::float AS historical_kwh,
          ROUND(AVG(wait_time_minutes)::numeric, 1)::float AS avg_wait_minutes
        FROM charging_events
        GROUP BY EXTRACT(HOUR FROM start_time)
        ORDER BY hour ASC
      `),
    ]);

    const run = runs[0] ?? null;
    const rawMetrics = (run?.metrics ?? {}) as {
      mae?: number;
      rmse?: number;
      r2?: number;
      cvR2Mean?: number;
      featureImportances?: Record<string, number>;
      areaForecasts?: Array<{
        area: string;
        predictedDailyDemandKwh: number;
        peakHourDemandKwh: number;
        activeVehicles: number;
        avgBatteryPct: number;
        hourly: Array<{ hour: number; predictedDemandKwh: number }>;
      }>;
    };

    const allForecasts = rawMetrics.areaForecasts ?? [];
    const filteredForecasts =
      areaFilter && areaFilter !== "ALL"
        ? allForecasts.filter((a) => a.area === areaFilter)
        : allForecasts;

    const histMap = new Map(
      histByHourRes.rows.map(
        (r: {
          hour: number;
          historical_sessions: number;
          historical_kwh: number;
          avg_wait_minutes: number;
        }) => [r.hour, r]
      )
    );

    const hourlyAggregate = Array.from({ length: 24 }, (_, hr) => {
      const predictedKwh = Number(
        filteredForecasts
          .reduce((sum, a) => {
            const found = a.hourly.find((h) => h.hour === hr);
            return sum + (found?.predictedDemandKwh ?? 0);
          }, 0)
          .toFixed(1)
      );
      const hist = histMap.get(hr);
      return {
        hour: hr,
        hourLabel: `${String(hr).padStart(2, "0")}:00`,
        predictedDemandKwh: predictedKwh,
        historicalSessions: hist?.historical_sessions ?? 0,
        historicalAvgDailyKwh: Number(((hist?.historical_kwh ?? 0) / 7).toFixed(1)),
        avgWaitMinutes: hist?.avg_wait_minutes ?? 0,
      };
    });

    return jsonOk({
      model: run
        ? {
            algorithmName: run.algorithmName,
            trainSamples: run.trainSamples,
            testSamples: run.testSamples,
            mae: rawMetrics.mae ?? 0,
            rmse: rawMetrics.rmse ?? 0,
            r2: rawMetrics.r2 ?? 0,
            cvR2Mean: rawMetrics.cvR2Mean ?? rawMetrics.r2 ?? 0,
            featureImportances: rawMetrics.featureImportances ?? {},
            artifactPath: run.artifactPath,
            storageBackend: run.storageBackend,
            trainedAt: run.trainedAt,
          }
        : null,
      totalPredictedDailyDemandKwh: Number(
        filteredForecasts
          .reduce((s, a) => s + a.predictedDailyDemandKwh, 0)
          .toFixed(1)
      ),
      areaForecasts: [...allForecasts].sort(
        (a, b) => b.predictedDailyDemandKwh - a.predictedDailyDemandKwh
      ),
      hourlyForecast: hourlyAggregate,
    });
  } catch (error) {
    console.error("[GET /api/charging-demand] Error:", error);
    return jsonError("Failed to retrieve charging demand forecast", 500);
  }
}

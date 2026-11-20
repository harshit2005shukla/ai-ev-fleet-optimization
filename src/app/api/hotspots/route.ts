import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { hotspotClusters, mlModelRuns } from "@/db/schema";
import { ensureSystemReady } from "@/lib/bootstrap";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await ensureSystemReady();
    const category = request.nextUrl.searchParams.get("category")?.trim().toUpperCase();

    const [clusters, clusterRun] = await Promise.all([
      category && ["BATTERY_RISK", "HIGH_DEMAND", "HIGH_ACTIVITY"].includes(category)
        ? db
            .select()
            .from(hotspotClusters)
            .where(eq(hotspotClusters.clusterCategory, category))
            .orderBy(desc(hotspotClusters.severityScore))
        : db
            .select()
            .from(hotspotClusters)
            .orderBy(desc(hotspotClusters.severityScore)),
      db
        .select()
        .from(mlModelRuns)
        .where(eq(mlModelRuns.modelTask, "kmeans_hotspots"))
        .limit(1),
    ]);

    return jsonOk({
      hotspots: clusters,
      grouped: {
        batteryRisk: clusters.filter((c) => c.clusterCategory === "BATTERY_RISK"),
        highDemand: clusters.filter((c) => c.clusterCategory === "HIGH_DEMAND"),
        highActivity: clusters.filter((c) => c.clusterCategory === "HIGH_ACTIVITY"),
      },
      modelInfo: clusterRun[0] ?? null,
    });
  } catch (error) {
    console.error("[GET /api/hotspots] Error:", error);
    return jsonError("Failed to fetch K-Means hotspot clusters", 500);
  }
}

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chargingRecommendations } from "@/db/schema";
import { ensureSystemReady } from "@/lib/bootstrap";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSystemReady();
    const top3 = await db
      .select()
      .from(chargingRecommendations)
      .where(eq(chargingRecommendations.isTop3, true))
      .orderBy(asc(chargingRecommendations.rank));

    return jsonOk({
      top3: top3.map((r) => ({
        rank: r.rank,
        latitude: r.latitude,
        longitude: r.longitude,
        area: r.area,
        corridor_label: r.corridorLabel,
        score: r.score,
        sub_scores: {
          battery_risk_demand: r.batteryRiskScore,
          ev_traffic_density: r.trafficDensityScore,
          delivery_delay: r.deliveryDelayScore,
          charger_gap_distance: r.chargerGapScore,
          predicted_demand: r.predictedDemandScore,
        },
        expected_ev_coverage: r.expectedEvCoverage,
        battery_risk_reduction_pct: r.batteryRiskReductionPct,
        expected_delay_reduction: r.expectedDelayReduction,
        expected_delay_reduction_pct: r.expectedDelayReductionPct,
        nearest_existing_station_id: r.nearestExistingStationId,
        nearest_existing_station_distance: r.nearestExistingStationDistance,
        predicted_daily_demand_kwh: r.predictedDailyDemandKwh,
        recommended_ports: r.recommendedPorts,
        recommended_power_kw: r.recommendedPowerKw,
        rationale: r.rationale,
      })),
    });
  } catch (error) {
    console.error("[GET /api/recommendations/top3] Error:", error);
    return jsonError("Failed to fetch top 3 charging recommendations", 500);
  }
}

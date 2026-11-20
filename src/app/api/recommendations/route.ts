import { asc } from "drizzle-orm";
import { db } from "@/db";
import { chargingRecommendations } from "@/db/schema";
import { ensureSystemReady } from "@/lib/bootstrap";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSystemReady();
    const items = await db
      .select()
      .from(chargingRecommendations)
      .orderBy(asc(chargingRecommendations.rank));

    return jsonOk({
      recommendations: items.map((r) => ({
        recommendation_id: r.recommendationId,
        rank: r.rank,
        is_top3: r.isTop3,
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
      methodology: {
        algorithm: "Exact Discrete Maximal-Covering Facility Location (p = 3) + Multi-Criteria Weighted Scoring",
        catchmentRadiusKm: 4.5,
        minSeparationBetweenNewStationsKm: 4.2,
        minSeparationFromExistingKm: 1.8,
        weights: {
          battery_risk_demand: 0.3,
          ev_traffic_density: 0.25,
          delivery_delay: 0.2,
          distance_from_existing_chargers: 0.15,
          predicted_charging_demand: 0.1,
        },
      },
    });
  } catch (error) {
    console.error("[GET /api/recommendations] Error:", error);
    return jsonError("Failed to fetch charging recommendations", 500);
  }
}

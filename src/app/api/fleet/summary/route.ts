import { pool } from "@/db";
import { ensureSystemReady } from "@/lib/bootstrap";
import { getAreaDemandForecastsFromDb } from "@/lib/mlEngine";
import { getStorageStatus } from "@/lib/s3";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSystemReady();

    const [
      kpiRes,
      batteryDistRes,
      trendRes,
      chargingTrendRes,
      riskCountsRes,
      areaForecasts,
      topCriticalRes,
    ] = await Promise.all([
      pool.query(`
        WITH latest AS (
          SELECT DISTINCT ON (vehicle_id) *
          FROM telemetry
          ORDER BY vehicle_id, timestamp DESC
        )
        SELECT
          (SELECT count(*)::int FROM vehicles) AS total_evs,
          (SELECT count(*)::int FROM vehicles WHERE status IN ('active', 'charging')) AS active_evs,
          (SELECT count(*)::int FROM vehicles WHERE status = 'charging') AS charging_evs,
          ROUND(AVG(l.battery_percentage)::numeric, 1)::float AS avg_battery_pct,
          COUNT(*) FILTER (WHERE l.battery_percentage < 25 OR COALESCE(p.battery_risk, 'LOW') = 'HIGH')::int AS critical_battery_vehicles,
          ROUND(AVG(COALESCE(p.predicted_range_km, l.remaining_range_km))::numeric, 1)::float AS avg_remaining_range_km,
          ROUND((SELECT AVG(delivery_delay_minutes) FROM telemetry)::numeric, 1)::float AS avg_delivery_delay_min,
          ROUND(AVG(l.nearest_station_distance_km)::numeric, 2)::float AS avg_distance_to_charger_km,
          (SELECT count(*)::int FROM telemetry) AS total_telemetry_records,
          (SELECT count(*)::int FROM trips) AS total_trips,
          (SELECT count(*)::int FROM charging_stations) AS total_charging_stations,
          (SELECT count(*)::int FROM charging_events) AS total_charging_events
        FROM latest l
        LEFT JOIN ml_predictions p ON p.vehicle_id = l.vehicle_id
      `),
      pool.query(`
        WITH latest AS (
          SELECT DISTINCT ON (vehicle_id) battery_percentage
          FROM telemetry
          ORDER BY vehicle_id, timestamp DESC
        ),
        buckets AS (
          SELECT
            CASE
              WHEN battery_percentage < 20 THEN '0–20%'
              WHEN battery_percentage < 40 THEN '20–40%'
              WHEN battery_percentage < 60 THEN '40–60%'
              WHEN battery_percentage < 80 THEN '60–80%'
              ELSE '80–100%'
            END AS band,
            CASE
              WHEN battery_percentage < 20 THEN 1
              WHEN battery_percentage < 40 THEN 2
              WHEN battery_percentage < 60 THEN 3
              WHEN battery_percentage < 80 THEN 4
              ELSE 5
            END AS sort_order
          FROM latest
        )
        SELECT band, sort_order, count(*)::int AS vehicles
        FROM buckets
        GROUP BY band, sort_order
        ORDER BY sort_order
      `),
      pool.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('day', timestamp), 'Mon DD') AS day_label,
          DATE_TRUNC('day', timestamp) AS bucket_day,
          ROUND(AVG(battery_percentage)::numeric, 1)::float AS avg_battery_pct,
          ROUND(AVG(remaining_range_km)::numeric, 1)::float AS avg_range_km,
          ROUND(AVG(delivery_delay_minutes)::numeric, 2)::float AS avg_delay_min,
          ROUND((COUNT(*) FILTER (WHERE battery_percentage >= 25)::numeric / GREATEST(1, COUNT(*)) * 100), 1)::float AS fleet_health_score,
          COUNT(*) FILTER (WHERE battery_percentage < 22)::int AS critical_events,
          COUNT(DISTINCT vehicle_id)::int AS active_vehicles,
          ROUND(SUM(distance_travelled_km * energy_consumption_kwh_per_km * 0.14)::numeric, 1)::float AS energy_demand_kwh
        FROM telemetry
        GROUP BY DATE_TRUNC('day', timestamp)
        ORDER BY bucket_day ASC
      `),
      pool.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('day', start_time), 'Mon DD') AS day_label,
          DATE_TRUNC('day', start_time) AS bucket_day,
          COUNT(*)::int AS sessions,
          ROUND(SUM(energy_delivered_kwh)::numeric, 1)::float AS energy_kwh,
          ROUND(AVG(wait_time_minutes)::numeric, 1)::float AS avg_wait_min
        FROM charging_events
        GROUP BY DATE_TRUNC('day', start_time)
        ORDER BY bucket_day ASC
      `),
      pool.query(`
        SELECT battery_risk, COUNT(*)::int AS count
        FROM ml_predictions
        GROUP BY battery_risk
      `),
      getAreaDemandForecastsFromDb(),
      pool.query(`
        WITH latest AS (
          SELECT DISTINCT ON (vehicle_id) *
          FROM telemetry
          ORDER BY vehicle_id, timestamp DESC
        )
        SELECT
          l.vehicle_id,
          v.vehicle_type,
          l.area,
          l.battery_percentage,
          COALESCE(p.predicted_range_km, l.remaining_range_km) AS predicted_range_km,
          l.nearest_station_distance_km,
          l.delivery_delay_minutes,
          COALESCE(p.battery_risk, 'LOW') AS battery_risk
        FROM latest l
        JOIN vehicles v ON v.vehicle_id = l.vehicle_id
        LEFT JOIN ml_predictions p ON p.vehicle_id = l.vehicle_id
        ORDER BY
          CASE COALESCE(p.battery_risk, 'LOW') WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
          l.battery_percentage ASC
        LIMIT 6
      `),
    ]);

    const kpi = kpiRes.rows[0];
    const predictedDailyDemandKwh = Number(
      areaForecasts
        .reduce((sum, a) => sum + a.predictedDailyDemandKwh, 0)
        .toFixed(0)
    );

    // Ensure all 5 battery histogram buckets appear even if a count is 0
    const allBands = ["0–20%", "20–40%", "40–60%", "60–80%", "80–100%"];
    const distMap = new Map(
      batteryDistRes.rows.map((r: { band: string; vehicles: number }) => [
        r.band,
        r.vehicles,
      ])
    );
    const batteryDistribution = allBands.map((band) => ({
      band,
      vehicles: distMap.get(band) ?? 0,
    }));

    // Merge charging event trend with daily projected demand
    const chargeMap = new Map(
      chargingTrendRes.rows.map(
        (r: { day_label: string; sessions: number; energy_kwh: number; avg_wait_min: number }) => [
          r.day_label,
          r,
        ]
      )
    );

    const dailyTrends = trendRes.rows.map(
      (r: {
        day_label: string;
        avg_battery_pct: number;
        avg_range_km: number;
        avg_delay_min: number;
        fleet_health_score: number;
        critical_events: number;
        active_vehicles: number;
        energy_demand_kwh: number;
      }) => {
        const ch = chargeMap.get(r.day_label);
        const actualKwh = ch?.energy_kwh ?? Math.round(r.energy_demand_kwh * 0.65);
        return {
          day: r.day_label,
          avgBatteryPct: r.avg_battery_pct,
          avgRangeKm: r.avg_range_km,
          avgDelayMin: r.avg_delay_min,
          fleetHealthScore: r.fleet_health_score,
          criticalEvents: r.critical_events,
          activeVehicles: r.active_vehicles,
          chargingSessions: ch?.sessions ?? 0,
          chargingEnergyKwh: Number(actualKwh.toFixed(1)),
          predictedDemandKwh: Number(
            (actualKwh * 1.08 + r.critical_events * 6.5).toFixed(1)
          ),
          avgWaitMin: ch?.avg_wait_min ?? 0,
        };
      }
    );

    const riskBreakdown: Record<string, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const r of riskCountsRes.rows) {
      riskBreakdown[r.battery_risk] = r.count;
    }

    return jsonOk({
      kpis: {
        totalEvs: kpi.total_evs ?? 0,
        activeEvs: kpi.active_evs ?? 0,
        chargingEvs: kpi.charging_evs ?? 0,
        avgBatteryPct: kpi.avg_battery_pct ?? 0,
        criticalBatteryVehicles: kpi.critical_battery_vehicles ?? 0,
        avgRemainingRangeKm: kpi.avg_remaining_range_km ?? 0,
        avgDeliveryDelayMin: kpi.avg_delivery_delay_min ?? 0,
        avgDistanceToChargerKm: kpi.avg_distance_to_charger_km ?? 0,
        predictedChargingDemandKwh: predictedDailyDemandKwh,
        totalTelemetryRecords: kpi.total_telemetry_records ?? 0,
        totalTrips: kpi.total_trips ?? 0,
        totalChargingStations: kpi.total_charging_stations ?? 0,
        totalChargingEvents: kpi.total_charging_events ?? 0,
      },
      riskBreakdown,
      batteryDistribution,
      dailyTrends,
      priorityWatchlist: topCriticalRes.rows,
      storage: getStorageStatus(),
    });
  } catch (error) {
    console.error("[GET /api/fleet/summary] Error:", error);
    return jsonError("Failed to compute executive fleet summary", 500);
  }
}

import { pool } from "@/db";
import { ensureSystemReady } from "@/lib/bootstrap";
import { getAreaDemandForecastsFromDb } from "@/lib/mlEngine";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSystemReady();

    const [
      evsByAreaRes,
      batteryTrendRes,
      tempVsRangeRes,
      speedVsEnergyRes,
      trafficVsDelayRes,
      demandByHourRes,
      efficiencyByTypeRes,
      scatterSampleRes,
      areaForecasts,
    ] = await Promise.all([
      // 1. EVs by area + risk & delay profile
      pool.query(`
        WITH latest AS (
          SELECT DISTINCT ON (vehicle_id) *
          FROM telemetry
          ORDER BY vehicle_id, timestamp DESC
        )
        SELECT
          l.area,
          COUNT(*)::int AS active_evs,
          ROUND(AVG(l.battery_percentage)::numeric, 1)::float AS avg_battery_pct,
          ROUND(AVG(l.remaining_range_km)::numeric, 1)::float AS avg_range_km,
          ROUND(AVG(l.delivery_delay_minutes)::numeric, 1)::float AS avg_delay_min,
          ROUND(AVG(l.nearest_station_distance_km)::numeric, 2)::float AS avg_charger_dist_km,
          COUNT(*) FILTER (WHERE COALESCE(p.battery_risk, 'LOW') = 'HIGH')::int AS high_risk_evs,
          COUNT(*) FILTER (WHERE COALESCE(p.battery_risk, 'LOW') = 'MEDIUM')::int AS medium_risk_evs,
          COUNT(*) FILTER (WHERE COALESCE(p.battery_risk, 'LOW') = 'LOW')::int AS low_risk_evs
        FROM latest l
        LEFT JOIN ml_predictions p ON p.vehicle_id = l.vehicle_id
        GROUP BY l.area
        ORDER BY active_evs DESC, high_risk_evs DESC
      `),
      // 2. Battery & energy trends over time
      pool.query(`
        SELECT
          TO_CHAR(DATE_TRUNC('day', timestamp), 'Mon DD') AS day,
          DATE_TRUNC('day', timestamp) AS sort_ts,
          ROUND(AVG(battery_percentage)::numeric, 1)::float AS avg_battery_pct,
          ROUND(PERCENTILE_CONT(0.15) WITHIN GROUP (ORDER BY battery_percentage)::numeric, 1)::float AS p15_battery_pct,
          ROUND(AVG(remaining_range_km)::numeric, 1)::float AS avg_range_km,
          ROUND(AVG(energy_consumption_kwh_per_km)::numeric, 3)::float AS avg_consumption_kwh_km
        FROM telemetry
        GROUP BY DATE_TRUNC('day', timestamp)
        ORDER BY sort_ts ASC
      `),
      // 3. Temperature vs Remaining Range (binned thermal efficiency curve)
      pool.query(`
        SELECT
          (FLOOR(temperature_c / 5.0) * 5)::int AS temp_bin,
          CONCAT((FLOOR(temperature_c / 5.0) * 5)::int, '°C') AS temp_label,
          COUNT(*)::int AS samples,
          ROUND(AVG(remaining_range_km)::numeric, 1)::float AS avg_range_km,
          ROUND(AVG(remaining_range_km / GREATEST(15, battery_percentage) * 80)::numeric, 1)::float AS normalized_80pct_range_km,
          ROUND(AVG(energy_consumption_kwh_per_km)::numeric, 3)::float AS avg_energy_kwh_km
        FROM telemetry
        GROUP BY FLOOR(temperature_c / 5.0)
        HAVING COUNT(*) >= 8
        ORDER BY temp_bin ASC
      `),
      // 4. Speed vs Energy Consumption (aerodynamic curve)
      pool.query(`
        SELECT
          (FLOOR(speed_kmh / 10.0) * 10)::int AS speed_bin,
          CONCAT((FLOOR(speed_kmh / 10.0) * 10)::int, '–', (FLOOR(speed_kmh / 10.0) * 10 + 10)::int) AS speed_label,
          COUNT(*)::int AS samples,
          ROUND(AVG(energy_consumption_kwh_per_km)::numeric, 3)::float AS avg_energy_kwh_km,
          ROUND(AVG(remaining_range_km)::numeric, 1)::float AS avg_range_km
        FROM telemetry
        WHERE speed_kmh >= 10 AND speed_kmh <= 115
        GROUP BY FLOOR(speed_kmh / 10.0)
        HAVING COUNT(*) >= 8
        ORDER BY speed_bin ASC
      `),
      // 5. Traffic Level vs Delivery Delay & Energy
      pool.query(`
        SELECT
          traffic_level,
          CASE traffic_level
            WHEN 'LOW' THEN 1
            WHEN 'MEDIUM' THEN 2
            WHEN 'HIGH' THEN 3
            WHEN 'SEVERE' THEN 4
            ELSE 5
          END AS sort_order,
          COUNT(*)::int AS records,
          ROUND(AVG(delivery_delay_minutes)::numeric, 2)::float AS avg_delay_min,
          ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY delivery_delay_minutes)::numeric, 1)::float AS p90_delay_min,
          ROUND(AVG(speed_kmh)::numeric, 1)::float AS avg_speed_kmh,
          ROUND(AVG(energy_consumption_kwh_per_km)::numeric, 3)::float AS avg_energy_kwh_km
        FROM telemetry
        GROUP BY traffic_level
        ORDER BY sort_order ASC
      `),
      // 6. Charging Demand & Telemetry Load by Hour of Day
      pool.query(`
        SELECT
          EXTRACT(HOUR FROM timestamp)::int AS hour,
          COUNT(*)::int AS telemetry_pings,
          COUNT(*) FILTER (WHERE battery_percentage < 30)::int AS low_battery_events,
          ROUND(AVG(battery_percentage)::numeric, 1)::float AS avg_battery_pct,
          ROUND(AVG(delivery_delay_minutes)::numeric, 1)::float AS avg_delay_min
        FROM telemetry
        GROUP BY EXTRACT(HOUR FROM timestamp)
        ORDER BY hour ASC
      `),
      // 7. Vehicle Efficiency by Vehicle Class
      pool.query(`
        SELECT
          v.vehicle_type,
          COUNT(DISTINCT v.vehicle_id)::int AS fleet_count,
          ROUND(AVG(v.battery_capacity_kwh)::numeric, 0)::float AS battery_capacity_kwh,
          ROUND(AVG(t.vehicle_weight_kg)::numeric, 0)::float AS avg_weight_kg,
          ROUND(AVG(t.energy_consumption_kwh_per_km)::numeric, 3)::float AS avg_kwh_per_km,
          ROUND((1.0 / AVG(t.energy_consumption_kwh_per_km))::numeric, 2)::float AS km_per_kwh,
          ROUND(AVG(t.remaining_range_km)::numeric, 1)::float AS avg_range_km,
          ROUND(AVG(t.delivery_delay_minutes)::numeric, 1)::float AS avg_delay_min
        FROM telemetry t
        JOIN vehicles v ON v.vehicle_id = t.vehicle_id
        GROUP BY v.vehicle_type
        ORDER BY avg_kwh_per_km ASC
      `),
      // Scatter sample for speed vs consumption visualization
      pool.query(`
        SELECT
          ROUND(speed_kmh::numeric, 1)::float AS speed_kmh,
          ROUND(energy_consumption_kwh_per_km::numeric, 3)::float AS energy_kwh_km,
          ROUND(temperature_c::numeric, 1)::float AS temperature_c,
          ROUND(remaining_range_km::numeric, 1)::float AS remaining_range_km,
          ROUND(vehicle_weight_kg::numeric, 0)::float AS weight_kg,
          traffic_level
        FROM telemetry
        WHERE id % GREATEST(1, (SELECT count(*)::int / 120 FROM telemetry)) = 0
        LIMIT 120
      `),
      getAreaDemandForecastsFromDb(),
    ]);

    const hourMap = new Map(
      demandByHourRes.rows.map(
        (r: {
          hour: number;
          telemetry_pings: number;
          low_battery_events: number;
          avg_battery_pct: number;
          avg_delay_min: number;
        }) => [r.hour, r]
      )
    );

    const chargingDemandByHour = Array.from({ length: 24 }, (_, hr) => {
      const predictedKwh = Number(
        areaForecasts
          .reduce(
            (sum, a) =>
              sum + (a.hourly.find((h) => h.hour === hr)?.predictedDemandKwh ?? 0),
            0
          )
          .toFixed(1)
      );
      const obs = hourMap.get(hr);
      return {
        hour: hr,
        hourLabel: `${String(hr).padStart(2, "0")}:00`,
        predictedDemandKwh: predictedKwh,
        lowBatteryEvents: obs?.low_battery_events ?? 0,
        avgBatteryPct: obs?.avg_battery_pct ?? 60,
        avgDelayMin: obs?.avg_delay_min ?? 0,
      };
    });

    return jsonOk({
      evsByArea: evsByAreaRes.rows,
      batteryTrends: batteryTrendRes.rows,
      temperatureVsRange: tempVsRangeRes.rows,
      speedVsEnergy: speedVsEnergyRes.rows,
      trafficVsDelay: trafficVsDelayRes.rows,
      chargingDemandByHour,
      vehicleEfficiency: efficiencyByTypeRes.rows,
      telemetryScatterSample: scatterSampleRes.rows,
    });
  } catch (error) {
    console.error("[GET /api/analytics] Error:", error);
    return jsonError("Failed to compute fleet analytics", 500);
  }
}

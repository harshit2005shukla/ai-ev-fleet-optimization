import { pool } from "@/db";
import { ensureSystemReady } from "@/lib/bootstrap";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSystemReady();

    const [stationsRes, fleetPinsRes] = await Promise.all([
      pool.query(`
        SELECT
          cs.station_id,
          cs.name,
          cs.area,
          cs.latitude,
          cs.longitude,
          cs.total_ports,
          cs.available_ports,
          cs.max_power_kw,
          cs.connector_type,
          cs.status,
          cs.operator,
          cs.avg_utilization_pct,
          cs.price_per_kwh,
          COUNT(ce.event_id)::int AS total_sessions,
          COALESCE(ROUND(SUM(ce.energy_delivered_kwh)::numeric, 1), 0)::float AS total_energy_kwh,
          COALESCE(ROUND(AVG(ce.wait_time_minutes)::numeric, 1), 0)::float AS avg_wait_minutes,
          COALESCE(ROUND(AVG(ce.duration_minutes)::numeric, 1), 0)::float AS avg_duration_minutes
        FROM charging_stations cs
        LEFT JOIN charging_events ce ON ce.station_id = cs.station_id
        GROUP BY cs.station_id
        ORDER BY cs.station_id ASC
      `),
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
          l.latitude,
          l.longitude,
          l.battery_percentage,
          l.speed_kmh,
          COALESCE(p.predicted_range_km, l.remaining_range_km) AS predicted_range_km,
          COALESCE(p.battery_risk, 'LOW') AS battery_risk,
          l.nearest_station_id,
          l.nearest_station_distance_km
        FROM latest l
        JOIN vehicles v ON v.vehicle_id = l.vehicle_id
        LEFT JOIN ml_predictions p ON p.vehicle_id = l.vehicle_id
        ORDER BY l.vehicle_id ASC
      `),
    ]);

    return jsonOk({
      stations: stationsRes.rows,
      liveFleetPositions: fleetPinsRes.rows,
      summary: {
        totalStations: stationsRes.rows.length,
        totalPorts: stationsRes.rows.reduce(
          (sum: number, s: { total_ports: number }) => sum + s.total_ports,
          0
        ),
        availablePorts: stationsRes.rows.reduce(
          (sum: number, s: { available_ports: number }) => sum + s.available_ports,
          0
        ),
        avgUtilizationPct: Number(
          (
            stationsRes.rows.reduce(
              (sum: number, s: { avg_utilization_pct: number }) => sum + s.avg_utilization_pct,
              0
            ) / Math.max(1, stationsRes.rows.length)
          ).toFixed(1)
        ),
        avgEvDistanceToStationKm: Number(
          (
            fleetPinsRes.rows.reduce(
              (sum: number, v: { nearest_station_distance_km: number }) =>
                sum + v.nearest_station_distance_km,
              0
            ) / Math.max(1, fleetPinsRes.rows.length)
          ).toFixed(2)
        ),
      },
    });
  } catch (error) {
    console.error("[GET /api/charging-stations] Error:", error);
    return jsonError("Failed to fetch charging stations", 500);
  }
}

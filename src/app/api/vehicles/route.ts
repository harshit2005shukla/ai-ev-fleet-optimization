import { NextRequest } from "next/server";
import { pool } from "@/db";
import { ensureSystemReady } from "@/lib/bootstrap";
import { jsonOk, jsonError, parsePagination, getCorsHeaders } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: getCorsHeaders() });
}

export async function GET(request: NextRequest) {
  try {
    await ensureSystemReady();
    const sp = request.nextUrl.searchParams;
    const { page, limit, offset } = parsePagination(sp, 20, 120);

    const risk = sp.get("risk")?.trim().toUpperCase() || "";
    const area = sp.get("area")?.trim() || "";
    const vehicleType = sp.get("vehicle_type")?.trim() || "";
    const timeRange = sp.get("time_range")?.trim() || "7d";
    const search = sp.get("search")?.trim() || "";

    const timeIntervalMap: Record<string, string> = {
      "6h": "6 hours",
      "24h": "24 hours",
      "3d": "3 days",
      "7d": "7 days",
      all: "365 days",
    };
    const interval = timeIntervalMap[timeRange] ?? "7 days";

    // Compute time anchor from latest telemetry timestamp in DB so filters are always exact
    const params: unknown[] = [interval];
    const conditions: string[] = [];

    if (risk && ["LOW", "MEDIUM", "HIGH"].includes(risk)) {
      params.push(risk);
      conditions.push(`COALESCE(p.battery_risk, 'LOW') = $${params.length}`);
    }
    if (area && area !== "ALL") {
      params.push(area);
      conditions.push(`lt.area = $${params.length}`);
    }
    if (vehicleType && vehicleType !== "ALL") {
      params.push(vehicleType);
      conditions.push(`v.vehicle_type = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(v.vehicle_id ILIKE $${params.length} OR v.model_name ILIKE $${params.length} OR lt.area ILIKE $${params.length} OR v.fleet_code ILIKE $${params.length})`
      );
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const baseCte = `
      WITH max_ts AS (
        SELECT COALESCE(MAX(timestamp), NOW()) AS latest FROM telemetry
      ),
      latest_telemetry AS (
        SELECT DISTINCT ON (t.vehicle_id)
          t.*
        FROM telemetry t
        CROSS JOIN max_ts m
        WHERE t.timestamp >= m.latest - $1::interval
        ORDER BY t.vehicle_id, t.timestamp DESC
      )
    `;

    const countRes = await pool.query(
      `${baseCte}
       SELECT COUNT(*)::int AS total
       FROM vehicles v
       JOIN latest_telemetry lt ON lt.vehicle_id = v.vehicle_id
       LEFT JOIN ml_predictions p ON p.vehicle_id = v.vehicle_id
       ${whereClause}`,
      params
    );
    const total = countRes.rows[0]?.total ?? 0;

    const dataParams = [...params, limit, offset];
    const rowsRes = await pool.query(
      `${baseCte}
       SELECT
         v.vehicle_id,
         v.fleet_code,
         v.model_name,
         v.vehicle_type,
         v.battery_capacity_kwh,
         v.max_payload_kg,
         v.nominal_range_km,
         v.home_area,
         v.status,
         lt.timestamp AS last_seen,
         lt.latitude,
         lt.longitude,
         lt.battery_percentage,
         lt.speed_kmh,
         lt.distance_travelled_km,
         lt.remaining_range_km,
         lt.temperature_c,
         lt.vehicle_weight_kg,
         lt.energy_consumption_kwh_per_km,
         lt.traffic_level,
         lt.delivery_status,
         lt.delivery_delay_minutes,
         lt.charging_status,
         lt.nearest_station_id,
         lt.nearest_station_distance_km,
         lt.area,
         COALESCE(p.predicted_range_km, lt.remaining_range_km) AS predicted_range_km,
         COALESCE(p.battery_risk, 'LOW') AS battery_risk,
         COALESCE(p.risk_probability, 0.85) AS risk_probability,
         p.range_model_name
       FROM vehicles v
       JOIN latest_telemetry lt ON lt.vehicle_id = v.vehicle_id
       LEFT JOIN ml_predictions p ON p.vehicle_id = v.vehicle_id
       ${whereClause}
       ORDER BY
         CASE COALESCE(p.battery_risk, 'LOW')
           WHEN 'HIGH' THEN 1
           WHEN 'MEDIUM' THEN 2
           ELSE 3
         END,
         lt.battery_percentage ASC,
         v.vehicle_id ASC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      dataParams
    );

    const filtersRes = await pool.query(`
      SELECT
        ARRAY(SELECT DISTINCT area FROM telemetry ORDER BY area) AS areas,
        ARRAY(SELECT DISTINCT vehicle_type FROM vehicles ORDER BY vehicle_type) AS vehicle_types
    `);

    return jsonOk({
      items: rowsRes.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      filterOptions: {
        areas: filtersRes.rows[0]?.areas ?? [],
        vehicleTypes: filtersRes.rows[0]?.vehicle_types ?? [],
        riskLevels: ["HIGH", "MEDIUM", "LOW"],
      },
    });
  } catch (error) {
    console.error("[GET /api/vehicles] Error:", error);
    return jsonError("Failed to fetch fleet vehicles", 500);
  }
}

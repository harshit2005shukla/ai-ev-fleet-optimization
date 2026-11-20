import { pool } from "@/db";
import { getStorageStatus } from "@/lib/s3";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const dbCheck = await pool.query("SELECT NOW() AS server_time");
    let telemetryCount = 0;
    let vehicleCount = 0;
    try {
      const counts = await pool.query(
        `SELECT
          (SELECT count(*)::int FROM vehicles) AS vehicles,
          (SELECT count(*)::int FROM telemetry) AS telemetry`
      );
      vehicleCount = counts.rows[0]?.vehicles ?? 0;
      telemetryCount = counts.rows[0]?.telemetry ?? 0;
    } catch {
      // Tables initialize automatically on first data endpoint hit
    }

    return jsonOk({
      status: "ok",
      service: "ev-fleet-optimization-analytics",
      database: "connected",
      serverTime: dbCheck.rows[0]?.server_time,
      counts: {
        vehicles: vehicleCount,
        telemetry: telemetryCount,
      },
      storage: getStorageStatus(),
    });
  } catch (error) {
    console.error("[GET /api/health] Database health check failed:", error);
    return jsonError("Database connection failed", 503);
  }
}

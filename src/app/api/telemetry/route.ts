import { NextRequest } from "next/server";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { telemetry } from "@/db/schema";
import { ensureSystemReady } from "@/lib/bootstrap";
import { jsonOk, jsonError, parsePagination } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await ensureSystemReady();
    const sp = request.nextUrl.searchParams;
    const { page, limit, offset } = parsePagination(sp, 50, 500);

    const filters = [];
    const vehicleId = sp.get("vehicle_id")?.trim().toUpperCase();
    const area = sp.get("area")?.trim();
    const trafficLevel = sp.get("traffic_level")?.trim().toUpperCase();
    const minBat = sp.get("min_battery");
    const maxBat = sp.get("max_battery");

    if (vehicleId) filters.push(eq(telemetry.vehicleId, vehicleId));
    if (area && area !== "ALL") filters.push(eq(telemetry.area, area));
    if (trafficLevel && ["LOW", "MEDIUM", "HIGH", "SEVERE"].includes(trafficLevel)) {
      filters.push(eq(telemetry.trafficLevel, trafficLevel));
    }
    if (minBat !== null && minBat !== "" && Number.isFinite(Number(minBat))) {
      filters.push(gte(telemetry.batteryPercentage, Number(minBat)));
    }
    if (maxBat !== null && maxBat !== "" && Number.isFinite(Number(maxBat))) {
      filters.push(lte(telemetry.batteryPercentage, Number(maxBat)));
    }

    const whereExpr = filters.length > 0 ? and(...filters) : undefined;

    const [[{ total }], items] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(telemetry)
        .where(whereExpr),
      db
        .select()
        .from(telemetry)
        .where(whereExpr)
        .orderBy(desc(telemetry.timestamp))
        .limit(limit)
        .offset(offset),
    ]);

    return jsonOk({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error("[GET /api/telemetry] Error:", error);
    return jsonError("Failed to query telemetry records", 500);
  }
}

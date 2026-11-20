import { ensureSystemReady } from "@/lib/bootstrap";
import { calculateDeliveryDelayImpact } from "@/lib/optimizer";
import { jsonOk, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSystemReady();
    const impact = await calculateDeliveryDelayImpact();
    if (!impact) {
      return jsonError("No telemetry data available for delay simulation", 404);
    }
    return jsonOk(impact);
  } catch (error) {
    console.error("[GET /api/delivery-impact] Error:", error);
    return jsonError("Failed to compute delivery delay impact simulation", 500);
  }
}

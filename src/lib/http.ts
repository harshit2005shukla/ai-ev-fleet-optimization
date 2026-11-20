import { NextResponse } from "next/server";

export function getCorsHeaders(): Record<string, string> {
  const configured = process.env.CORS_ORIGINS?.trim() || "*";
  const allowOrigin = configured.includes(",")
    ? configured.split(",")[0].trim()
    : configured;

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: getCorsHeaders(),
  });
}

export function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    {
      error: message,
      ...(details !== undefined ? { details } : {}),
      timestamp: new Date().toISOString(),
    },
    {
      status,
      headers: getCorsHeaders(),
    }
  );
}

export function parsePagination(
  searchParams: URLSearchParams,
  defaultLimit = 25,
  maxLimit = 200
) {
  const rawPage = Number(searchParams.get("page") ?? "1");
  const rawLimit = Number(searchParams.get("limit") ?? String(defaultLimit));
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(maxLimit, Math.floor(rawLimit))
      : defaultLimit;
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

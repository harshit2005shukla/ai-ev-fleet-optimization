import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

function getDatabaseUrl(): string {
  const rawDatabaseUrl = process.env.DATABASE_URL;

  if (!rawDatabaseUrl) {
    throw new Error(
      "DATABASE_URL is required at runtime. Configure it in Render Environment Variables."
    );
  }

  return rawDatabaseUrl.startsWith("postgres://")
    ? rawDatabaseUrl.replace("postgres://", "postgresql://")
    : rawDatabaseUrl;
}

function createPool(): Pool {
  const databaseUrl = getDatabaseUrl();

  const isRemoteSsl =
    databaseUrl.includes("render.com") ||
    databaseUrl.includes("neon.tech") ||
    process.env.DB_SSL === "true";

  return new Pool({
    connectionString: databaseUrl,
    max: 12,
    idleTimeoutMillis: 30000,
    ...(isRemoteSsl
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
  });
}

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ?? createPool();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool, { schema });

export { schema };
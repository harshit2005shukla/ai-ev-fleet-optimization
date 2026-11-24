import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const rawDatabaseUrl =
  process.env.DATABASE_URL || "postgresql://localhost:5432/app_db";

// Normalize legacy Render postgres:// scheme to postgresql://
const databaseUrl = rawDatabaseUrl.startsWith("postgres://")
  ? rawDatabaseUrl.replace("postgres://", "postgresql://")
  : rawDatabaseUrl;

const isRemoteSsl =
  databaseUrl.includes("render.com") ||
  databaseUrl.includes("neon.tech") ||
  process.env.DB_SSL === "true";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    max: 12,
    idleTimeoutMillis: 30000,
    ...(isRemoteSsl
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool, { schema });

export { schema };
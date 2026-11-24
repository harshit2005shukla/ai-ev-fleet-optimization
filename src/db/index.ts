import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  pool?: Pool;
  db?: ReturnType<typeof drizzle>;
};

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is required at runtime");
  }

  return url;
}

function createPool(): Pool {
  return new Pool({
    connectionString: getDatabaseUrl(),
    ssl:
      process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : undefined,
  });
}

export function getPool(): Pool {
  if (!globalForDb.pool) {
    globalForDb.pool = createPool();
  }

  return globalForDb.pool;
}

export function getDb() {
  if (!globalForDb.db) {
    globalForDb.db = drizzle(getPool(), {
      schema,
    });
  }

  return globalForDb.db;
}

/*
 * Backward-compatible exports.
 *
 * Existing API routes import:
 *   import { db } from "@/db";
 *   import { pool } from "@/db";
 *
 * So both names must exist.
 */
export const pool = getPool();
export const db = getDb();

export { schema };
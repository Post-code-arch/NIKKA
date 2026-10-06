import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";

export type DB = BetterSQLite3Database<typeof schema>;

const globalForDb = globalThis as unknown as { __nikkaDb?: DB };

/** Single SQLite connection per process, migrated on first use. */
export function getDb(): DB {
  if (globalForDb.__nikkaDb) return globalForDb.__nikkaDb;
  const file = path.resolve(process.env.NIKKA_DB_PATH ?? "./data/nikka.db");
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), "db/migrations") });
  globalForDb.__nikkaDb = db;
  return db;
}

export { schema };

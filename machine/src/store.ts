import { Pool } from "pg";
import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger";

/**
 * Durable persistence for the dashboard state.
 *
 * Source of truth at runtime is the in-memory state object in activity.ts.
 * This module makes that state SURVIVE redeploys by snapshotting the whole
 * state object to Postgres (single JSONB row). The local JSON file is kept as
 * a dev/offline fallback so the app works with or without a database.
 *
 * Design goals:
 *  - Never crash the bot if the DB is briefly unreachable — every DB call is
 *    guarded and falls back to the file / in-memory state.
 *  - Postgres is preferred on load (it's the value that survived the redeploy);
 *    the file is only used when there is no DB or the DB is empty.
 */

const DATABASE_URL = process.env.DATABASE_URL?.trim() || "";
const DATA_DIR = process.env.STATE_DIR || path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

let pool: Pool | null = null;
export const hasDatabase = !!DATABASE_URL;

if (hasDatabase) {
  // Railway's internal (*.railway.internal) URL needs no SSL; the public proxy
  // URL does. rejectUnauthorized:false keeps managed-PG self-signed certs OK.
  const internal = DATABASE_URL.includes("railway.internal") || DATABASE_URL.includes("sslmode=disable");
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: internal ? false : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // A pool 'error' event on an idle client must not crash the process.
  pool.on("error", (e) => logger.warn(`PG pool error (non-fatal): ${e.message}`));
}

export async function initStore(): Promise<void> {
  if (!pool) {
    logger.info("No DATABASE_URL — using local JSON file for state (ephemeral on Railway).");
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dashboard_state (
        id INT PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT single_row CHECK (id = 1)
      );
    `);
    logger.info("Postgres connected — dashboard state is now durable across redeploys.");
  } catch (e) {
    logger.error(`Postgres init failed (continuing on file fallback): ${e instanceof Error ? e.message : e}`);
  }
}

export async function loadStateAsync(): Promise<unknown | null> {
  if (!pool) return null;
  try {
    const r = await pool.query("SELECT data FROM dashboard_state WHERE id = 1");
    return r.rows[0]?.data ?? null;
  } catch (e) {
    logger.warn(`Postgres load failed (falling back to file): ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

export function loadStateFile(): unknown | null {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE + ".tmp", "utf-8"));
    } catch {
      /* nothing */
    }
  }
  return null;
}

export async function saveStateAsync(state: unknown): Promise<boolean> {
  if (!pool) return false;
  try {
    await pool.query(
      `INSERT INTO dashboard_state (id, data, updated_at)
       VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [JSON.stringify(state)]
    );
    return true;
  } catch (e) {
    logger.warn(`Postgres save failed (will retry next flush): ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

export function saveStateFile(state: unknown): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STATE_FILE + ".tmp";
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeSync(fd, JSON.stringify(state, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, STATE_FILE);
  } catch {
    /* best-effort */
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    try { await pool.end(); } catch { /* nothing */ }
  }
}

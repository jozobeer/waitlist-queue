import { Hono } from "hono";

// workers-types 非依存方針（DOM lib と衝突するため）の最小 D1 型。使うメソッドだけ宣言する
export interface D1Like {
  prepare(query: string): {
    first<T = unknown>(): Promise<T | null>;
    bind(...values: unknown[]): { first<T = unknown>(): Promise<T | null>; run(): Promise<unknown> };
    all<T = unknown>(): Promise<{ results: T[] }>;
    run(): Promise<unknown>;
  };
}

type Entry = {
  position: number;
  name: string;
  createdAt: number;
};

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 10_000;
const MAX_BODY_BYTES = 1024;
const MAX_NAME_LENGTH = 24;

const INSERT_ENTRY_SQL = `INSERT INTO entries (name, client_key, created_at)
SELECT ?1, ?2, ?3
WHERE (SELECT COUNT(*) FROM entries WHERE client_key = ?2 AND created_at > ?4) < ?5
RETURNING position, name, created_at`;

const app = new Hono<{ Bindings: { DB: D1Like } }>();

// 機械検証と監視が依存する。migrations 適用済みスキーマへ実 SELECT して 200 を返す。壊さないこと
app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT count(*) AS n FROM app_meta").first<{ n: number }>();
  return row != null ? c.json({ ok: true }) : c.json({ ok: false }, 500);
});

app.get("/api/entries", async (c) => {
  const { results } = await c.env.DB
    .prepare("SELECT position, name, created_at FROM entries ORDER BY position ASC")
    .all<{ position: number; name: string; created_at: number }>();
  const entries = results.map((row) => ({
    position: row.position,
    name: row.name,
    createdAt: row.created_at,
  }));
  return c.json({ entries, total: entries.length });
});

app.post("/api/entries", async (c) => {
  const raw = await c.req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return c.json({ error: "too_large" }, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid_name" }, 400);
  }

  const name =
    parsed !== null && typeof parsed === "object" && "name" in parsed
      ? normalizeName((parsed as { name: unknown }).name)
      : null;
  if (name == null) {
    return c.json({ error: "invalid_name" }, 400);
  }

  const key = clientKey((header) => c.req.header(header));
  const entry = await insertEntryIfAllowed(c.env.DB, name, key, Date.now());
  if (entry == null) {
    return c.json({ error: "rate_limited", retryAfterSec: 10 }, 429);
  }
  return c.json({ entry }, 201);
});

export default app;

export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\u0000-\u001F]/g, "").trim();
  const length = Array.from(cleaned).length;
  if (length < 1 || length > MAX_NAME_LENGTH) return null;
  return cleaned;
}

export function clientKey(headerGet: (name: string) => string | undefined): string {
  const cf = headerGet("CF-Connecting-IP")?.trim();
  if (cf) return cf;
  const forwarded = headerGet("X-Forwarded-For");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return "unknown";
}

export async function insertEntryIfAllowed(
  db: D1Like,
  name: string,
  key: string,
  now: number,
): Promise<Entry | null> {
  const row = await db
    .prepare(INSERT_ENTRY_SQL)
    .bind(name, key, now, now - RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX)
    .first<{ position: number; name: string; created_at: number }>();
  if (row == null) return null;
  return { position: row.position, name: row.name, createdAt: row.created_at };
}

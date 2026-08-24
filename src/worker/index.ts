import { Hono } from "hono";

// workers-types 非依存方針（DOM lib と衝突するため）の最小 D1 型。使うメソッドだけ宣言する
export interface D1Like {
  prepare(query: string): {
    first<T = unknown>(): Promise<T | null>;
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results: T[] }>;
      run(): Promise<unknown>;
    };
    all<T = unknown>(): Promise<{ results: T[] }>;
    run(): Promise<unknown>;
  };
}

type Entry = {
  position: number;
  name: string;
  createdAt: number;
};

const ROOM_ID_RE = /^[0-9a-f]{8}$/;
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 10_000;
const ROOM_RATE_LIMIT_MAX = 20;
const ROOM_RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 1024;
const ROOM_MAX_BODY_BYTES = 256;
const MAX_NAME_LENGTH = 24;
const ROOM_NAME_MAX = 40;
const ID_REGENERATIONS = 3;

const INSERT_ROOM_SQL = `INSERT INTO rooms (id, name, client_key, created_at)
SELECT ?1, ?2, ?3, ?4
WHERE (SELECT COUNT(*) FROM rooms WHERE client_key = ?3 AND created_at > ?5) < ?6
RETURNING id, name`;

const INSERT_ENTRY_SQL = `INSERT INTO entries (name, client_key, created_at, room_id)
SELECT ?1, ?2, ?3, ?4
WHERE (SELECT COUNT(*) FROM entries WHERE client_key = ?2 AND created_at > ?5 AND room_id = ?4) < ?6
RETURNING position, name, created_at`;

const RANK_SQL = `SELECT COUNT(*) AS n FROM entries WHERE room_id = ?1 AND position < ?2`;

const LIST_ENTRIES_SQL = `SELECT position, name, created_at FROM entries WHERE room_id = ?1 ORDER BY position ASC`;

const app = new Hono<{ Bindings: { DB: D1Like } }>();

// 機械検証と監視が依存する。migrations 適用済みスキーマへ実 SELECT して 200 を返す。壊さないこと
app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT count(*) AS n FROM app_meta").first<{ n: number }>();
  return row != null ? c.json({ ok: true }) : c.json({ ok: false }, 500);
});

app.post("/api/rooms", async (c) => {
  const parsed = await parseRoomBody(c.req.raw);
  if (parsed === 400 || parsed === 413) return c.json({ error: true }, parsed);

  const key = clientKey((header) => c.req.header(header));
  const id = await allocateRoomId(c.env.DB);
  if (!id) return c.json({ error: true }, 500);

  const room = await insertRoomIfAllowed(c.env.DB, id, parsed.name, key, Date.now());
  if (room == null) return c.json({ error: true }, 429);
  return c.json(room, 201);
});

app.get("/api/rooms/:id", async (c) => {
  const id = c.req.param("id");
  if (!ROOM_ID_RE.test(id)) return c.json({ error: true }, 404);

  const room = await c.env.DB
    .prepare("SELECT id, name FROM rooms WHERE id = ?1")
    .bind(id)
    .first<{ id: string; name: string }>();
  if (room == null) return c.json({ error: true }, 404);

  const { results } = await c.env.DB
    .prepare(LIST_ENTRIES_SQL)
    .bind(id)
    .all<{ position: number; name: string; created_at: number }>();
  const entries = toDisplayEntries(results);
  return c.json({ id: room.id, name: room.name, entries, total: entries.length });
});

app.post("/api/rooms/:id/entries", async (c) => {
  const id = c.req.param("id");
  if (!ROOM_ID_RE.test(id)) return c.json({ error: true }, 404);

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

  const room = await c.env.DB.prepare("SELECT id FROM rooms WHERE id = ?1").bind(id).first();
  if (room == null) return c.json({ error: true }, 404);

  const key = clientKey((header) => c.req.header(header));
  const entry = await insertEntryIfAllowed(c.env.DB, name, key, Date.now(), id);
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
  roomId: string,
): Promise<Entry | null> {
  const row = await db
    .prepare(INSERT_ENTRY_SQL)
    .bind(name, key, now, roomId, now - RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX)
    .first<{ position: number; name: string; created_at: number }>();
  if (row == null) return null;
  const rank = await db.prepare(RANK_SQL).bind(roomId, row.position).first<{ n: number }>();
  return { position: (rank?.n ?? 0) + 1, name: row.name, createdAt: row.created_at };
}

async function allocateRoomId(db: D1Like): Promise<string | null> {
  for (let n = 0; n <= ID_REGENERATIONS; n++) {
    const id = crypto.randomUUID().slice(0, 8);
    const hit = await db.prepare("SELECT id FROM rooms WHERE id = ?1").bind(id).first();
    if (hit == null) return id;
  }
  return null;
}

async function insertRoomIfAllowed(
  db: D1Like,
  id: string,
  name: string,
  key: string,
  now: number,
): Promise<{ id: string; name: string } | null> {
  const row = await db
    .prepare(INSERT_ROOM_SQL)
    .bind(id, name, key, now, now - ROOM_RATE_LIMIT_WINDOW_MS, ROOM_RATE_LIMIT_MAX)
    .first<{ id: string; name: string }>();
  return row == null ? null : { id: row.id, name: row.name };
}

function toDisplayEntries(
  rows: { position: number; name: string; created_at: number }[],
): Entry[] {
  return rows.map((row, i) => ({
    position: i + 1,
    name: row.name,
    createdAt: row.created_at,
  }));
}

async function parseRoomBody(req: Request): Promise<{ name: string } | 400 | 413> {
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > ROOM_MAX_BODY_BYTES) return 413;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 400;
  }
  return parseRoomName(parsed);
}

function parseRoomName(parsed: unknown): { name: string } | 400 {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return 400;
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "name") return 400;
  const name = (parsed as { name: unknown }).name;
  if (typeof name !== "string") return 400;
  const trimmed = name.trim();
  const len = [...trimmed].length;
  if (len < 1 || len > ROOM_NAME_MAX) return 400;
  return { name: trimmed };
}

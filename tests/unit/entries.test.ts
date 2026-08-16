import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../src/worker/index";

type FakeOptions = {
  first?: unknown | null;
  all?: unknown[];
};

function fakeDb(options: FakeOptions = {}) {
  const prepared: { sql: string; bound: unknown[] }[] = [];
  return {
    prepared,
    prepare(sql: string) {
      const rec = { sql, bound: [] as unknown[] };
      prepared.push(rec);
      const stmt = {
        bind(...values: unknown[]) {
          rec.bound = values;
          return stmt;
        },
        async first() {
          return "first" in options ? options.first : null;
        },
        async all() {
          return { results: options.all ?? [] };
        },
        async run() {
          return {};
        },
      };
      return stmt;
    },
  };
}

function post(
  db: ReturnType<typeof fakeDb>,
  body: string | object,
  headers: Record<string, string> = {},
) {
  return app.request(
    "/api/entries",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    { DB: db },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/entries は INSERT ... RETURNING の position をそのまま返す", () => {
  it("フェイク D1 が RETURNING で返した position が 201 の entry.position と一致する", async () => {
    const db = fakeDb({
      first: { position: 7, name: "たろう", created_at: 1_700_000_000_000 },
    });

    const res = await post(db, { name: "たろう" });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      entry: { position: 7, name: "たろう", createdAt: 1_700_000_000_000 },
    });
  });

  it("発行される SQL に MAX( を含まない", async () => {
    const db = fakeDb({
      first: { position: 1, name: "a", created_at: 1 },
    });

    await post(db, { name: "a" });

    const sql = db.prepared.map((p) => p.sql).join("\n");
    expect(sql).toContain("INSERT");
    expect(sql).not.toMatch(/MAX\s*\(/i);
  });
});

describe("GET /api/entries は件数上限なしで全件を position 昇順に返す", () => {
  it("1500 件をそのまま返し total は entries.length と等しい", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      position: i + 1,
      name: `n${i + 1}`,
      created_at: 1_000 + i,
    }));
    const db = fakeDb({ all: rows });

    const res = await app.request("/api/entries", {}, { DB: db });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      entries: { position: number; name: string }[];
      total: number;
    };
    expect(body.entries).toHaveLength(1500);
    expect(body.entries[0]?.position).toBe(1);
    expect(body.entries[1499]?.position).toBe(1500);
    expect(body.total).toBe(1500);
    expect(body.total).toBe(body.entries.length);
  });

  it("SQL は ORDER BY position ASC を含み LIMIT を含まない", async () => {
    const db = fakeDb({ all: [] });
    await app.request("/api/entries", {}, { DB: db });

    expect(db.prepared).toHaveLength(1);
    const sql = db.prepared[0]!.sql;
    expect(sql).toContain("ORDER BY position ASC");
    expect(sql.toUpperCase()).not.toContain("LIMIT");
  });
});

describe("POST /api/entries の入力上限", () => {
  it("name 24 文字は 201、25 文字と空白のみと数値は 400 invalid_name", async () => {
    const okDb = fakeDb({
      first: { position: 1, name: "あ".repeat(24), created_at: 1 },
    });
    const ok = await post(okDb, { name: "あ".repeat(24) });
    expect(ok.status).toBe(201);

    const tooLong = await post(fakeDb(), { name: "あ".repeat(25) });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: "invalid_name" });

    const blank = await post(fakeDb(), { name: "   " });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: "invalid_name" });

    const numeric = await post(fakeDb(), { name: 1 });
    expect(numeric.status).toBe(400);
    expect(await numeric.json()).toEqual({ error: "invalid_name" });
  });

  it("ボディ 1024 バイトはバリデーションに進み、1025 バイトは 413 too_large", async () => {
    const allowed = await post(fakeDb(), "x".repeat(1024));
    expect(allowed.status).not.toBe(413);
    expect(allowed.status).toBe(400);

    const denied = await post(fakeDb(), "x".repeat(1025));
    expect(denied.status).toBe(413);
    expect(await denied.json()).toEqual({ error: "too_large" });
  });
});

describe("レートリミット判定は単一の条件付き INSERT で行う", () => {
  it("SQL は 1 文で INSERT / SELECT COUNT(*) / RETURNING を含み、窓下限は now-10000 で比較は >、上限は 3", async () => {
    const now = 1_700_000_010_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const db = fakeDb({
      first: { position: 2, name: "a", created_at: now },
    });

    await post(db, { name: "a" }, { "CF-Connecting-IP": "203.0.113.9" });

    expect(db.prepared).toHaveLength(1);
    const sql = db.prepared[0]!.sql;
    expect(sql).toContain("INSERT");
    expect(sql).toContain("SELECT COUNT(*)");
    expect(sql).toContain("RETURNING");
    expect(sql).toMatch(/created_at\s*>\s*\?4/);
    expect(sql).not.toMatch(/created_at\s*>=/);

    expect(db.prepared[0]!.bound).toEqual(["a", "203.0.113.9", now, now - 10_000, 3]);
  });

  it("first() が行を返すと 201、null なら 429 と retryAfterSec:10", async () => {
    const allowed = await post(
      fakeDb({ first: { position: 3, name: "a", created_at: 1 } }),
      { name: "a" },
    );
    expect(allowed.status).toBe(201);
    expect((await allowed.json() as { entry: { position: number } }).entry.position).toBe(3);

    const limited = await post(fakeDb({ first: null }), { name: "a" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited", retryAfterSec: 10 });
  });
});

describe("client_key の解決順", () => {
  it("CF-Connecting-IP があればそれを使い、なければ X-Forwarded-For の先頭、どちらも無ければ unknown", async () => {
    const cf = fakeDb({ first: { position: 1, name: "a", created_at: 1 } });
    await post(cf, { name: "a" }, { "CF-Connecting-IP": "203.0.113.10", "X-Forwarded-For": "198.51.100.1" });
    expect(cf.prepared[0]!.bound[1]).toBe("203.0.113.10");

    const xff = fakeDb({ first: { position: 1, name: "a", created_at: 1 } });
    await post(xff, { name: "a" }, { "X-Forwarded-For": "198.51.100.2, 10.0.0.1" });
    expect(xff.prepared[0]!.bound[1]).toBe("198.51.100.2");

    const none = fakeDb({ first: { position: 1, name: "a", created_at: 1 } });
    await post(none, { name: "a" });
    expect(none.prepared[0]!.bound[1]).toBe("unknown");
  });

  it("別々の client_key が bind にそのまま渡り同じ窓を共有しない", async () => {
    const a = fakeDb({ first: { position: 1, name: "a", created_at: 1 } });
    await post(a, { name: "a" }, { "CF-Connecting-IP": "2001:db8::1" });
    const b = fakeDb({ first: { position: 2, name: "b", created_at: 1 } });
    await post(b, { name: "b" }, { "CF-Connecting-IP": "2001:db8::2" });

    expect(a.prepared[0]!.bound[1]).toBe("2001:db8::1");
    expect(b.prepared[0]!.bound[1]).toBe("2001:db8::2");
    expect(a.prepared[0]!.bound[1]).not.toBe(b.prepared[0]!.bound[1]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../src/worker/index";
import { fakeDb, throwsOnPrepare } from "./fake-d1";

const ROOM_ID = "abcd1234";

function post(
  db: ReturnType<typeof fakeDb> | ReturnType<typeof throwsOnPrepare>,
  body: string | object,
  headers: Record<string, string> = {},
  roomId = ROOM_ID,
) {
  return app.request(
    `/api/rooms/${roomId}/entries`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
    { DB: db },
  );
}

function isInsert(sql: string): boolean {
  return /^\s*INSERT\b/i.test(sql);
}

function roomLookupDb(
  room: { id: string; name: string } | null,
  insertRow: { position: number; name: string; created_at: number } | null,
  rankCount = 0,
) {
  return fakeDb({
    first: (sql: string) => {
      if (isInsert(sql)) return insertRow;
      if (/FROM\s+rooms/i.test(sql)) return room;
      if (/SELECT COUNT\(\*\)/i.test(sql)) return { n: rankCount };
      return null;
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/rooms/:id/entries は受付内の表示番号を返す", () => {
  it("AUTOINCREMENT ではなく自分より小さい position の件数+1 を返す", async () => {
    const db = roomLookupDb(
      { id: ROOM_ID, name: "窓口" },
      { position: 7, name: "たろう", created_at: 1_700_000_000_000 },
      2,
    );

    const res = await post(db, { name: "たろう" });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      entry: { position: 3, name: "たろう", createdAt: 1_700_000_000_000 },
    });
  });

  it("発行される SQL に MAX( を含まない", async () => {
    const db = roomLookupDb(
      { id: ROOM_ID, name: "窓口" },
      { position: 1, name: "a", created_at: 1 },
      0,
    );

    await post(db, { name: "a" });

    const sql = db.prepared.map((p) => p.sql).join("\n");
    expect(sql).toContain("INSERT");
    expect(sql).not.toMatch(/MAX\s*\(/i);
  });
});

describe("POST /api/rooms/:id/entries の入力上限", () => {
  it("name 24 文字は 201、25 文字と空白のみと数値は 400 invalid_name", async () => {
    const okDb = roomLookupDb(
      { id: ROOM_ID, name: "窓口" },
      { position: 1, name: "あ".repeat(24), created_at: 1 },
      0,
    );
    const ok = await post(okDb, { name: "あ".repeat(24) });
    expect(ok.status).toBe(201);

    const tooLong = await post(fakeDb({ first: { id: ROOM_ID, name: "窓口" } }), {
      name: "あ".repeat(25),
    });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toEqual({ error: "invalid_name" });

    const blank = await post(fakeDb({ first: { id: ROOM_ID, name: "窓口" } }), { name: "   " });
    expect(blank.status).toBe(400);
    expect(await blank.json()).toEqual({ error: "invalid_name" });

    const numeric = await post(fakeDb({ first: { id: ROOM_ID, name: "窓口" } }), { name: 1 });
    expect(numeric.status).toBe(400);
    expect(await numeric.json()).toEqual({ error: "invalid_name" });
  });

  it("ボディ 1024 バイトはバリデーションに進み、1025 バイトは 413 too_large", async () => {
    const allowed = await post(fakeDb({ first: { id: ROOM_ID, name: "窓口" } }), "x".repeat(1024));
    expect(allowed.status).not.toBe(413);
    expect(allowed.status).toBe(400);

    const denied = await post(fakeDb(), "x".repeat(1025));
    expect(denied.status).toBe(413);
    expect(await denied.json()).toEqual({ error: "too_large" });
  });
});

describe("レートリミット判定は単一の条件付き INSERT で行う", () => {
  it("SQL は 1 文で INSERT / SELECT COUNT(*) / RETURNING を含み、窓下限は now-10000、上限は 3、room_id 付き", async () => {
    const now = 1_700_000_010_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const db = roomLookupDb(
      { id: ROOM_ID, name: "窓口" },
      { position: 2, name: "a", created_at: now },
      0,
    );

    await post(db, { name: "a" }, { "CF-Connecting-IP": "203.0.113.9" });

    const insert = db.prepared.filter((p) => isInsert(p.sql));
    expect(insert).toHaveLength(1);
    const sql = insert[0]!.sql;
    expect(sql).toContain("INSERT");
    expect(sql).toContain("SELECT COUNT(*)");
    expect(sql).toContain("RETURNING");
    expect(sql).toMatch(/room_id/);
    expect(sql).toMatch(/created_at\s*>\s*\?/);
    expect(sql).not.toMatch(/created_at\s*>=/);

    expect(insert[0]!.bound).toEqual(["a", "203.0.113.9", now, ROOM_ID, now - 10_000, 3]);
  });

  it("first() が行を返すと 201、null なら 429 と retryAfterSec:10", async () => {
    const allowed = await post(
      roomLookupDb({ id: ROOM_ID, name: "窓口" }, { position: 3, name: "a", created_at: 1 }, 2),
      { name: "a" },
    );
    expect(allowed.status).toBe(201);
    expect((await allowed.json() as { entry: { position: number } }).entry.position).toBe(3);

    const limited = await post(roomLookupDb({ id: ROOM_ID, name: "窓口" }, null), { name: "a" });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited", retryAfterSec: 10 });
  });
});

describe("無い受付と形式不正は INSERT しない", () => {
  it("無い受付は 404 で INSERT しない", async () => {
    const db = fakeDb({ first: null });
    const res = await post(db, { name: "a" });
    expect(res.status).toBe(404);
    expect(db.prepared.filter((p) => isInsert(p.sql))).toHaveLength(0);
  });

  it("形式不正の id は prepare せず 404", async () => {
    const db = throwsOnPrepare();
    const res = await post(db, { name: "a" }, {}, "zzzzzzzz");
    expect(res.status).toBe(404);
  });
});

describe("client_key の解決順", () => {
  it("CF-Connecting-IP があればそれを使い、なければ X-Forwarded-For の先頭、どちらも無ければ unknown", async () => {
    const cf = roomLookupDb({ id: ROOM_ID, name: "窓口" }, { position: 1, name: "a", created_at: 1 }, 0);
    await post(cf, { name: "a" }, { "CF-Connecting-IP": "203.0.113.10", "X-Forwarded-For": "198.51.100.1" });
    const cfInsert = cf.prepared.find((p) => isInsert(p.sql));
    expect(cfInsert!.bound[1]).toBe("203.0.113.10");

    const xff = roomLookupDb({ id: ROOM_ID, name: "窓口" }, { position: 1, name: "a", created_at: 1 }, 0);
    await post(xff, { name: "a" }, { "X-Forwarded-For": "198.51.100.2, 10.0.0.1" });
    expect(xff.prepared.find((p) => isInsert(p.sql))!.bound[1]).toBe("198.51.100.2");

    const none = roomLookupDb({ id: ROOM_ID, name: "窓口" }, { position: 1, name: "a", created_at: 1 }, 0);
    await post(none, { name: "a" });
    expect(none.prepared.find((p) => isInsert(p.sql))!.bound[1]).toBe("unknown");
  });

  it("別々の client_key が bind にそのまま渡り同じ窓を共有しない", async () => {
    const a = roomLookupDb({ id: ROOM_ID, name: "窓口" }, { position: 1, name: "a", created_at: 1 }, 0);
    await post(a, { name: "a" }, { "CF-Connecting-IP": "2001:db8::1" });
    const b = roomLookupDb({ id: ROOM_ID, name: "窓口" }, { position: 2, name: "b", created_at: 1 }, 0);
    await post(b, { name: "b" }, { "CF-Connecting-IP": "2001:db8::2" });

    expect(a.prepared.find((p) => isInsert(p.sql))!.bound[1]).toBe("2001:db8::1");
    expect(b.prepared.find((p) => isInsert(p.sql))!.bound[1]).toBe("2001:db8::2");
  });
});

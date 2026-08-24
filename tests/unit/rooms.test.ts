import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../src/worker/index";
import { fakeDb, throwsOnPrepare } from "./fake-d1";

function postRoom(
  db: ReturnType<typeof fakeDb> | ReturnType<typeof throwsOnPrepare>,
  body: string | object,
  headers: Record<string, string> = {},
) {
  return app.request(
    "/api/rooms",
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/rooms", () => {
  it("201 で {id, name} を返し、id は 8 桁 16 進、name は trim 済み", async () => {
    const db = fakeDb({
      first: (sql: string, bound: unknown[]) => {
        if (isInsert(sql)) return { id: bound[0], name: bound[1] };
        return null;
      },
    });

    const res = await postRoom(db, { name: "  窓口A  " });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.id).toMatch(/^[0-9a-f]{8}$/);
    expect(body.name).toBe("窓口A");
  });

  it("257 バイトのボディは 413", async () => {
    const db = fakeDb();
    const res = await postRoom(db, "x".repeat(257));
    expect(res.status).toBe(413);
    expect(db.prepared.filter((p) => isInsert(p.sql))).toHaveLength(0);
  });

  it("空・41 文字・未知フィールドは 400", async () => {
    const empty = await postRoom(fakeDb(), { name: "   " });
    expect(empty.status).toBe(400);

    const tooLong = await postRoom(fakeDb(), { name: "あ".repeat(41) });
    expect(tooLong.status).toBe(400);

    const extra = await postRoom(fakeDb(), { name: "窓口", extra: 1 });
    expect(extra.status).toBe(400);
  });

  it("同一キー 21 件目は 429", async () => {
    let inserts = 0;
    const db = fakeDb({
      first: (sql: string, bound: unknown[]) => {
        if (!isInsert(sql)) return null;
        inserts += 1;
        if (inserts > 20) return null;
        return { id: bound[0], name: bound[1] };
      },
    });

    for (let i = 0; i < 20; i++) {
      const res = await postRoom(db, { name: `窓口${i}` });
      expect(res.status).toBe(201);
    }
    const denied = await postRoom(db, { name: "窓口21" });
    expect(denied.status).toBe(429);
  });

  it("衝突し続けると 500", async () => {
    const db = fakeDb({
      first: () => ({ id: "aaaaaaaa" }),
    });

    const res = await postRoom(db, { name: "窓口" });

    expect(res.status).toBe(500);
    expect(db.prepared.filter((p) => isInsert(p.sql))).toHaveLength(0);
  });

  it("判定と挿入は単一文で、60 秒窓・上限 20・rooms テーブルを数える", async () => {
    const now = 1_700_000_060_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const db = fakeDb({
      first: (sql: string, bound: unknown[]) =>
        isInsert(sql) ? { id: bound[0], name: bound[1] } : null,
    });

    await postRoom(db, { name: "窓口" }, { "CF-Connecting-IP": "203.0.113.9" });

    const insert = db.prepared.find((p) => isInsert(p.sql));
    expect(insert).toBeDefined();
    const sql = insert!.sql;
    expect(sql).toContain("INSERT");
    expect(sql).toContain("SELECT COUNT(*)");
    expect(sql).toContain("RETURNING");
    expect(sql).toMatch(/FROM\s+rooms/i);
    expect(sql).toMatch(/created_at\s*>\s*\?5/);
    expect(sql).not.toMatch(/created_at\s*>=/);
    expect(insert!.bound).toEqual([
      expect.stringMatching(/^[0-9a-f]{8}$/),
      "窓口",
      "203.0.113.9",
      now,
      now - 60_000,
      20,
    ]);
  });
});

describe("GET /api/rooms/:id", () => {
  it("形式不正は prepare せず 404", async () => {
    const db = throwsOnPrepare();
    const z = await app.request("/api/rooms/zzzzzzzz", {}, { DB: db });
    expect(z.status).toBe(404);
    const short = await app.request("/api/rooms/0123456", {}, { DB: db });
    expect(short.status).toBe(404);
  });

  it("未存在は 404", async () => {
    const db = fakeDb({ first: null });
    const res = await app.request("/api/rooms/00000000", {}, { DB: db });
    expect(res.status).toBe(404);
  });

  it("作成直後は entries 空・total 0", async () => {
    const db = fakeDb({
      first: { id: "abcd1234", name: "窓口A" },
      all: [],
    });

    const res = await app.request("/api/rooms/abcd1234", {}, { DB: db });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: "abcd1234",
      name: "窓口A",
      entries: [],
      total: 0,
    });
  });

  it("3 件参加後の position は受付内の 1,2,3 で AUTOINCREMENT 値ではない", async () => {
    const db = fakeDb({
      first: { id: "abcd1234", name: "窓口A" },
      all: [
        { position: 10, name: "たろう", created_at: 1 },
        { position: 20, name: "はなこ", created_at: 2 },
        { position: 30, name: "じろう", created_at: 3 },
      ],
    });

    const res = await app.request("/api/rooms/abcd1234", {}, { DB: db });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: { position: number; name: string }[];
      total: number;
    };
    expect(body.entries.map((e) => e.position)).toEqual([1, 2, 3]);
    expect(body.entries.map((e) => e.name)).toEqual(["たろう", "はなこ", "じろう"]);
    expect(body.total).toBe(3);
    expect(body.total).toBe(body.entries.length);
  });

  it("SQL は room_id で絞り ORDER BY position ASC を含み LIMIT を含まない", async () => {
    const db = fakeDb({
      first: { id: "abcd1234", name: "窓口A" },
      all: [],
    });
    await app.request("/api/rooms/abcd1234", {}, { DB: db });

    const list = db.prepared.find((p) => /FROM\s+entries/i.test(p.sql));
    expect(list).toBeDefined();
    expect(list!.sql).toContain("ORDER BY position ASC");
    expect(list!.sql.toUpperCase()).not.toContain("LIMIT");
    expect(list!.bound).toEqual(["abcd1234"]);
  });
});

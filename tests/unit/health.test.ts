import { describe, expect, it } from "vitest";
import app from "../../src/worker/index";

// D1 のフェイク。builder は自分のクエリに合わせて拡張してよい
function fakeDb(row: unknown = { n: 0 }) {
  const stmt = {
    first: async () => row,
    bind: () => stmt,
    all: async () => ({ results: [] }),
    run: async () => ({}),
  };
  return { prepare: () => stmt };
}

describe("GET /api/health", () => {
  it("D1 への SELECT に成功すると 200 と ok:true を返す", async () => {
    const res = await app.request("/api/health", {}, { DB: fakeDb() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

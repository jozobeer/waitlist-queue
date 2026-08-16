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

const app = new Hono<{ Bindings: { DB: D1Like } }>();

// 機械検証と監視が依存する。migrations 適用済みスキーマへ実 SELECT して 200 を返す。壊さないこと
app.get("/api/health", async (c) => {
  const row = await c.env.DB.prepare("SELECT count(*) AS n FROM app_meta").first<{ n: number }>();
  return row != null ? c.json({ ok: true }) : c.json({ ok: false }, 500);
});

export default app;

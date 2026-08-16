# 先着順ウェイトリスト

名前を入れて「参加する」を押すと、サーバが 1 から始まる連番の整理券番号を発行し、「あなたの整理券番号は N 番です」と表示する匿名の共有待ち行列。一覧は番号昇順の「N 番 名前」で、人数は「現在 N 人が参加中」。どのブラウザから開いても同じ一覧が見える。入力は名前だけ（正規化後 1〜24 文字）。同一クライアントは 10 秒に 3 件まで。接続できないときは見出しとフッターが残り、「一覧を取得できませんでした」と出る。自分の番号は `localStorage` に残る。

## 公開URL

https://waitlist-queue.jozo.beer

## 開発

[kojo](https://github.com/jozobeer/kojo)（1日1アプリ自動生成基盤）により生成されたリポジトリです。

初回セットアップ: `npm install`（Playwright ブラウザ未取得の環境では `npx playwright install chromium`）

- `npm run dev` — wrangler dev でローカル起動（http://127.0.0.1:8787）
- `npm test` — build → typecheck → vitest（ユニット）→ Playwright（E2E）
- `npm run verify` — 不変条件チェック（favicon / apps.jozo.beer フッター / 単一ファイル出力）
- `npm run deploy` — ビルドして Cloudflare Workers へデプロイ

## 構成

- `index.html` + `src/ui/` — React UI の正本（`public/index.html` はビルド出力）
  - `App.tsx` — 一覧・参加フォーム・自分の番号カード。状態はここだけに持ち、参加成功後は一覧を再取得する
  - `JoinForm.tsx` / `QueueList.tsx` — 名前入力と「参加する」、番号昇順の一覧
- `src/worker/index.ts` — Hono（`GET /api/health`・`GET /api/entries`・`POST /api/entries`。永続化は D1）
- `tests/unit/` — vitest ユニットテスト、`tests/app.spec.ts` — Playwright E2E
- `PLAN.md` — 初回実装時の計画（歴史的文書。現状の正は本 README とテスト）

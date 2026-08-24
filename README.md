# 先着順ウェイトリスト

受付名を入れて作成すると共有URL（`#/r/<id>`）が発行される。そのURLを知る人だけが同じ待ち行列に並び、名前を入れて「参加する」と受付内で 1 から始まる整理券番号が出る。一覧は番号昇順の「N 番 名前」で、人数は「現在 N 人が参加中」。入力は名前だけ（正規化後 1〜24 文字）。同一クライアントは、その受付につき 10 秒に 3 件まで。接続できないときは見出しとフッターが残る。自分の番号は受付ごとに `localStorage` に残る。

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
  - `App.tsx` — `#/r/<id>` で Home / Room を切る。状態は各画面に持ち、参加成功後は一覧を再取得する
  - `Home.tsx` — 受付名の入力と作成。参加フォームと一覧は置かない
  - `Room.tsx` — 受付名、参加、一覧、共有URL。`JoinForm.tsx` / `QueueList.tsx` を使う
- `src/worker/index.ts` — Hono（`GET /api/health`・`POST /api/rooms`・`GET /api/rooms/:id`・`POST /api/rooms/:id/entries`。永続化は D1）
- `tests/unit/` — vitest ユニットテスト、`tests/app.spec.ts` — Playwright E2E
- `PLAN.md` — 初回実装時の計画（歴史的文書。現状の正は本 README とテスト）

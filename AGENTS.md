# 先着順ウェイトリスト

このリポジトリは kojo が生成した Web アプリです（React UI + Hono API）。公開後の保守はこのリポジトリ単体で行います。

## アプリ概要と構成

名前を入れて「参加する」を押すと、D1 の `AUTOINCREMENT` が 1 から始まる整理券番号を発行し、画面に `あなたの整理券番号は N 番です` と出す。一覧は番号昇順の `N 番 <名前>` で、人数は `現在 N 人が参加中`。認証もセッションもなく、どのブラウザから開いても同じ一覧。入力欄は名前 1 つだけ。一覧に「自分」のハイライトは付けない（自分の番号は上部カードのみ。再訪時は `localStorage["waitlist.myPosition"]`）。

| 領域 | 実装 |
|------|------|
| UI | `index.html` + `src/ui/`。状態は `App.tsx` に集約し props で配る。初回マウントで `GET /api/entries`。参加成功後に一覧を再取得。`file://` でも骨格が出る（未処理の `fetch` 失敗を残さない） |
| API | `src/worker/index.ts`。`GET /api/health`（`app_meta` への実 SELECT）、`GET /api/entries`（全件・`ORDER BY position ASC`・`LIMIT` なし・`total` は `entries.length`）、`POST /api/entries`。`/api/*` は JSON のみ（HTML を返さない） |
| 永続化 | D1 のみ（`c.env.DB`）。`entries(position AUTOINCREMENT, name, client_key, created_at)`。番号は `MAX(position)+1` の read-modify-write にしない |
| 書込制限 | 名前は前後空白と制御文字を除いた 1〜24 コードポイント。受信ボディ 1024 バイト超は 413。同一 `client_key` は 10 秒窓で 3 件まで。判定と挿入は単一の条件付き `INSERT ... SELECT ... WHERE (SELECT COUNT(*)) < 3 ... RETURNING`。`client_key` は `CF-Connecting-IP` → `X-Forwarded-For` 先頭 → `"unknown"` |
| テスト | API/ロジックは `tests/unit/*.test.ts`（D1 はフェイクを `app.request` の第3引数で注入）。ブラウザ挙動は `tests/app.spec.ts`。雛形のスモークと health テストは削除しない |

並行参加でも番号が重複せず、同一クライアントの同時投稿でも 3 件を超えないことが受け入れの核。COUNT と INSERT を別文に分けると上限が破れる。

## 技術スタック（不変）

- TypeScript / React 19（ReactCompiler有効。状態管理ライブラリ禁止、リフトアップとprops受け渡しのみ） / Hono / Vite + vite-plugin-singlefile / vitest + Playwright
- UI の正本は `index.html` と `src/ui/`。`public/index.html` は単一ファイルのビルド出力（直接編集しない）
- 配信: Cloudflare Workers（main=`src/worker/index.ts`、assets=`public/`、/api/* が Worker に落ちる）
- 保守時もこのスタックを維持すること。フレームワーク・ビルドツール・宣言外ライブラリの導入は禁止

## 品質不変条件

次を壊さないこと。変更後は `npm run verify` が通る状態を維持する。

- favicon は `index.html` の `<head>` に `<link rel="icon" href="data:image/svg+xml,...">` のインライン data URI（外部ファイル・外部 URL 不可）
- hub（apps.jozo.beer）へのフッターは `#root` の外に置く。リンク先 `https://apps.jozo.beer` とリンクテキスト `apps.jozo.beer` は変えない

```html
<footer style="margin-top:3rem;text-align:center;font-size:.8rem;opacity:.6">
  <a href="https://apps.jozo.beer" style="color:inherit">apps.jozo.beer</a>
</footer>
```

スタイル（リンク色を含む）はテーマに合わせて調整してよい。リンク色を変える場合は背景とのコントラストを確保する。

その他:

- `public/` は `npm run build` の出力なので直接編集しない
- README.md は削除しない
- apple-touch-icon / manifest / og-image / robots / sitemap は公開基盤が生成するため書かない
- 雛形のスモークテストと health テストは削除しない
- サーバ側の永続化は D1 binding（`c.env.DB`）のみ。KV/DO・外部 API は使わない
- スキーマ変更は `migrations/` に新しい連番の SQL ファイルを追加する。適用済み migration の書き換えと `app_meta` テーブルの削除は禁止
- `GET /api/health` は D1 への実 SELECT（`app_meta`）で 200 と `{"ok":true}` を返し続ける（機械検証が依存）
- 匿名書込エンドポイントには入力サイズ上限・バリデーション・簡易レートリミットを維持する
- UI は API に到達できなくても骨格（タイトル・フッター）を描画する（視覚検証は `file://` で行われる）

## 保守の進め方

1. 変更前に受け入れ条件をテストにする（API/ロジックは `tests/unit/*.test.ts`、ブラウザ挙動は `tests/app.spec.ts`）
2. 実装する
3. `npm test` が通ることを確認する
4. `git commit` と `git push`
5. `npm run deploy`

## PLAN.md について

`PLAN.md` は初回実装時の計画であり歴史的文書である。現状の正は README.md とテスト（`tests/`）である。受け入れ条件の追加・変更はテストと README に反映する。

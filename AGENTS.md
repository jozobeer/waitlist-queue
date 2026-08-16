# 先着順ウェイトリスト

このリポジトリは kojo が生成した Web アプリです（React UI + Hono API）。

## アイデア

# 先着順ウェイトリスト

名前を入力して「参加」ボタンを押すと、サーバが発行する連番の順位（整理券番号）が割り当てられる、匿名の共有待ち行列アプリ。誰がいつ参加しても、同じ順位一覧を全員が閲覧できる。

## 意図

限定枠のイベントや先着受付を、個人アカウントなしで「今何番目か」を主催者・参加者全員が同じ状態で確認したい場面で使う。

## 受け入れ条件の種

- 「参加」を押すと連番の順位が割り当てられて表示され、同時に複数人が参加しても順位が重複しない
- 別ブラウザ（別セッション）で一覧を開くと、既に参加した全員の順位一覧が同じ内容で見える
- 参加者は名前以外の個人情報を入力せず、認証なしで参加できる


## 技術スタック（不変）

- TypeScript / React 19（ReactCompiler有効。状態管理ライブラリ禁止、リフトアップとprops受け渡しのみ） / Hono / Vite + vite-plugin-singlefile / vitest + Playwright
- UI の正本は `index.html` と `src/ui/`。`public/index.html` は単一ファイルのビルド出力（直接編集しない）
- 配信: Cloudflare Workers（main=`src/worker/index.ts`、assets=`public/`、/api/* が Worker に落ちる）
- 保守時もこのスタックを維持すること。フレームワーク・ビルドツール・宣言外ライブラリの導入は禁止

## 制約

- サーバは src/worker/index.ts の Hono アプリ。/api/* の JSON のみを提供し、HTML を返さない
- サーバ側の永続化は D1 binding（c.env.DB）のみ。KV/DO・外部 API は使わない
- スキーマ変更は migrations/ に新しい連番の SQL ファイルを追加して行う。適用済み migration の書き換えと app_meta テーブルの削除は禁止
- GET /api/health は D1 への実 SELECT（app_meta）を実行して 200 と {"ok":true} を返し続けること（機械検証が依存。壊さない）
- 匿名書込エンドポイントには入力サイズ上限・バリデーション・簡易レートリミットを必ず実装する
- UI は API に到達できなくても骨格（タイトル・フッター）を描画すること（視覚検証は file:// で行われる）
- 受け入れ条件のテスト: API/ロジックは tests/unit/*.test.ts（vitest、D1 はフェイクを app.request の第3引数で注入）、ブラウザ挙動は tests/app.spec.ts（Playwright）に書く
- PLAN.md の受け入れ条件それぞれに対応するテストを書き、`npm test` が通ること。API/ロジックは `tests/unit/*.test.ts`（vitest）、ブラウザ挙動は `tests/app.spec.ts`（Playwright）。雛形のスモークテストと health テストは削除しない
- UI の正本は `index.html` と `src/ui/`。`public/` は `npm run build` の出力なので直接編集しない
- favicon は `index.html` の `<head>` に `<link rel="icon" href="data:image/svg+xml,...">` のインライン data URI で含める（外部ファイル・外部URL不可。アプリのテーマに合った絵柄にする）
- hub（apps.jozo.beer）へのフッター導線は `index.html` の React ルート（`#root`）の外に置く（JS が読めない環境でも描画されるため）。マークアップは次のとおり固定する:

  ```html
  <footer style="margin-top:3rem;text-align:center;font-size:.8rem;opacity:.6">
    <a href="https://apps.jozo.beer" style="color:inherit">apps.jozo.beer</a>
  </footer>
  ```

  スタイル（リンク色を含む）はアプリのテーマに合わせて調整してよいが、リンク先 `https://apps.jozo.beer` とリンクテキスト `apps.jozo.beer` は変えない。リンク色を変える場合は背景とのコントラストを確保すること
- README.md はテンプレートが生成済み。削除しないこと
- apple-touch-icon / manifest / og-image / robots / sitemap は factory が公開時に自動生成するため、builder は書かない
- 完成条件: PLAN.md の受け入れ条件をすべて満たし、`npm run verify` と `npm test` が通ること

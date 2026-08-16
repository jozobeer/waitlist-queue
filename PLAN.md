# 先着順ウェイトリスト

## 1. 概要

名前を入力して「参加する」を押すと、サーバが連番の整理券番号（1 から始まる重複しない整数）を発行し、その番号を画面に返す匿名の共有待ち行列アプリ。番号の採番は D1 の `INTEGER PRIMARY KEY AUTOINCREMENT` による単一 INSERT でアトミックに行うため、複数人が同時に参加しても番号は重複しない。参加者一覧（番号と名前）はサーバが持つ唯一の状態で、認証もセッションも持たないため、どのブラウザ・どの端末から開いても全員が同じ順位一覧を見る。匿名書込を守るため、名前の長さ・リクエストボディサイズ・クライアント単位の投稿頻度に上限を設ける（頻度の判定は採番と同じ 1 文の条件付き INSERT に載せ、同時リクエストでも上限を超えないようにする）。一覧は件数上限を付けずに全件返す。

## 2. 意図（明示）

限定枠のイベントや先着受付を、個人アカウントなしで「今何番目か」を主催者・参加者全員が同じ状態で確認したい場面で使う。

## 3. 受け入れ条件

- [ ] **AC1 連番採番**: 「参加する」を押すと整理券番号が割り当てられ、`あなたの整理券番号は N 番です` として画面に表示される。番号は参加のたびに 1 ずつ増える。5 つの独立したブラウザセッションが同時に参加した場合も、割り当てられた 5 個の番号は重複せず、参加直前の最大番号 `max` に対して `max+1` から `max+5` までと過不足なく一致する。
- [ ] **AC2 全員が同じ一覧**: 別ブラウザセッション（別 browser context・別 localStorage）で開くと、既に参加した**全員**の `N 番 <名前>` が番号昇順で、先に参加したセッションの一覧と文字列として完全一致して表示される。合計人数の表示（`現在 N 人が参加中`）も一致し、その数値は表示行数と常に等しい（件数上限による欠落を許さない）。
- [ ] **AC3 匿名 + 入力バリデーション**: 参加フォームの入力欄は名前 1 つだけで、認証・ログイン導線を持たない。名前が空（前後空白を除いて 0 文字）または 25 文字以上のときは参加が拒否され、画面にエラー文言が出て一覧の人数は増えない。24 文字ちょうどは参加できる。
- [ ] **AC4 レートリミット**: 同一クライアントからの参加は 10 秒の時間窓につき 3 件まで許可する。3 件目（ちょうど N 回目）は成功して番号が表示され、4 件目は `参加が集中しています。10 秒ほど待って再度お試しください` が表示されて一覧の人数は増えない。最後の成功から 10 秒経過後は再び参加できる。**同一クライアント扱いの 6 セッションが同時に参加操作した場合も、番号が表示されるのは正確に 3 セッション・残り 3 セッションは上記エラー文言で、一覧の増分もちょうど 3 件**（逐次でも並行でも上限は変わらない）。
- [ ] **AC5 API 不達でも骨格が出る**: API に到達できない状態（`file://` でビルド出力を開く）でも、タイトル `先着順ウェイトリスト` と `apps.jozo.beer` フッターリンクが描画され、ページエラーが発生しない。

## 4. 実装方針

### 4.1 データモデル（`migrations/0002_entries.sql` を新規追加）

```sql
CREATE TABLE IF NOT EXISTS entries (
  position   INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  client_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_client ON entries(client_key, created_at);
```

- `position` が整理券番号そのもの。SQLite の `AUTOINCREMENT` は単調増加で削除後も再利用されないため、番号の一意性・単調性を DB が保証する。
- `client_key` はレートリミット判定専用（後述）。名前以外の個人情報は保存しない。

### 4.2 API（`src/worker/index.ts` / Hono）

`GET /api/health` は現行実装（`app_meta` への実 SELECT）をそのまま維持する。

**`POST /api/entries`**

リクエスト: `{"name": "たろう"}`（`application/json`）

処理順と応答:

1. ボディサイズ: 生テキストが 1024 バイト超 → `413 {"error":"too_large"}`
2. JSON パース失敗 / `name` が文字列でない → `400 {"error":"invalid_name"}`
3. `name` を正規化（前後の空白除去、U+0000〜U+001F の制御文字を除去）した結果が 0 文字、または 25 コードポイント以上 → `400 {"error":"invalid_name"}`
4. レートリミット判定と挿入を **1 文の条件付き INSERT** で同時に行う（後述 `insertEntryIfAllowed`）。行が返れば成功 → `201 {"entry":{"position":N,"name":"...","createdAt":<epoch ms>}}`、行が返らなければ窓内上限に達している → `429 {"error":"rate_limited","retryAfterSec":10}`

**`GET /api/entries`**

`200 {"entries":[{"position":1,"name":"...","createdAt":...}, ...],"total":N}`。SQL は `SELECT position, name, created_at FROM entries ORDER BY position ASC` で、**件数上限（`LIMIT`）を付けない**。`total` は返した `entries` の件数そのもの（`entries.length`）。

- 件数上限を置かない理由: AC2 は「既に参加した**全員**が同じ一覧を見る」ことを求めており、上限を付けると超過分が黙って欠落して AC2 が偽になる（`total` と表示行数も食い違う）。1 行は高々 120 バイト程度で、想定規模（イベント 1 回分の待ち行列）なら全件返して問題ない。将来ページングが要るとしても**黙って切り詰めない** —— AC2 とテストを同時に変える
- `total` を `SELECT COUNT(*)` の別文にしない理由: 一覧と件数が別スナップショットになり食い違いうる。同一結果セットから導出すれば「`total` = 表示行数」が構造として保証される

**主要関数**（すべて `src/worker/index.ts` 内、テストのため named export する）

- `normalizeName(raw: unknown): string | null` — 正規化と長さ検証。不正なら `null`
- `clientKey(headerGet: (name: string) => string | undefined): string` — `CF-Connecting-IP` → `X-Forwarded-For` の先頭要素 → `"unknown"` の優先順。Cloudflare 上では `CF-Connecting-IP` がエッジで必ず上書きされるため偽装できない
- `insertEntryIfAllowed(db, name, key, now): Promise<Entry | null>` — レート判定と採番・挿入を**単一文**で行う。行が返れば成功、`first()` が `null` なら窓内上限に達している（＝ 429）

  ```sql
  INSERT INTO entries (name, client_key, created_at)
  SELECT ?1, ?2, ?3
  WHERE (SELECT COUNT(*) FROM entries WHERE client_key = ?2 AND created_at > ?4) < ?5
  RETURNING position, name, created_at
  ```

  bind は `(name, key, now, now - RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX)`。`?2` を 2 箇所で使うため番号付きプレースホルダにする。

  - **`COUNT` と `INSERT` を別文に分けるのは禁止**。分けると同一クライアントの同時リクエストが同じ件数を読み、10 秒窓に 4 件以上通ってしまう。単一文なら COUNT サブクエリの評価と挿入が同じ暗黙トランザクション内で起き、他の書込が割り込めない
  - **`MAX(position)+1` を読んでから書く採番も禁止**（競合で番号が重複する）。番号は `AUTOINCREMENT` に任せる
  - 実測（`wrangler dev` のローカル D1 に同型 SQL を投げた結果）: 同一 `client_key` で 6 本・8 本を同時 POST しても、成功はちょうど 3 件で残りは全て 429

**確定した境界値**

| 対象 | 値 | 判定 |
| --- | --- | --- |
| ボディサイズ | 1024 バイト | 許可 |
| ボディサイズ | 1025 バイト | 413 |
| 名前（正規化後のコードポイント数） | 0 | 400 |
| 名前 | 1 〜 24 | 許可 |
| 名前 | 25 以上 | 400 |
| 条件付き INSERT の `COUNT` サブクエリ値 | 0 / 1 / 2（＝ 1〜3 件目） | 行が挿入されて返る（許可） |
| 条件付き INSERT の `COUNT` サブクエリ値 | 3 以上（＝ 4 件目） | 行が返らない → 429 |
| `created_at` がちょうど `now - 10000` | 窓外（`>` 判定のため数えない） | 許可側に寄る |
| `created_at` が `now - 9999` | 窓内（数える） | 拒否側に寄る |

定数は `RATE_LIMIT_MAX = 3`、`RATE_LIMIT_WINDOW_MS = 10_000`、`MAX_BODY_BYTES = 1024`、`MAX_NAME_LENGTH = 24` として `src/worker/index.ts` に置く。

### 4.3 UI（`src/ui/`、React 19 + React Compiler）

状態管理ライブラリは使わない。状態は `App.tsx` に集約し、子へは props で渡す（リフトアップのみ）。

構成:

- `src/ui/App.tsx` — 状態 `entries` / `total` / `myPosition` / `listError` / `formError` / `submitting` を保持。初回マウントで `GET /api/entries`。参加成功時はレスポンスの `position` を `myPosition` に入れて `localStorage["waitlist.myPosition"]` に保存し、一覧を再取得する。`fetch` の例外は握りつぶさず `listError` / `formError` に落とし、骨格は描画し続ける（未処理の rejection を残さない）
- `src/ui/JoinForm.tsx` — props: `{ onJoin(name), submitting, error }`。入力欄は名前 1 つのみ（`<input type="text" data-testid="name-input">`）+ `<button data-testid="join-button">参加する</button>`
- `src/ui/QueueList.tsx` — props: `{ entries, total, listError }`。行は `<li data-testid="entry-row" data-position={position}>{position} 番 {name}</li>`、番号昇順。0 件のときは `まだ誰も参加していません`、`listError` があるときは代わりに `<p data-testid="list-error">一覧を取得できませんでした</p>`（「誰もいない」と「取得できていない」を同じ文言にしない）
- `src/ui/api.ts` — `fetchEntries()` / `joinWaitlist(name)` と型定義、`error` コードから日本語文言へのマッピング

レイアウト（縦 1 カラム、`max-width: 32rem`）:

1. `<h1>先着順ウェイトリスト</h1>` と 1 行の説明
2. 自分の番号カード `data-testid="my-position"`：`あなたの整理券番号は N 番です`（未参加時は非表示）
3. 参加フォーム（名前入力 + ボタン）。エラーは `<p role="alert" data-testid="form-error">`
4. 一覧見出し `現在 N 人が参加中`（`data-testid="total"`）と番号昇順のリスト

**一覧はどのセッションでも完全に同一**にする。「自分の行」のハイライトやバッジは一覧に入れず、自分の番号は上部カードにのみ出す（AC2 の同一性を壊さないため）。

## 5. テスト計画

受け入れ条件と 1 対 1 で対応させる。**各 AC は `tests/app.spec.ts` の実ブラウザテストを主とし、画面に表示される実値（番号・名前・人数・エラー文言）を直接アサートする**。存在確認や部品単位の確認だけでは合格としない。境界値の厳密な検証（サーバ時刻を動かす必要があるもの）は `tests/unit/entries.test.ts` の vitest で補強する。

**フェイク D1 は条件付き INSERT の意味論を再現しない**ため、vitest で検証できるのは「発行する SQL の形」と「行が返る／返らない場合の分岐」までである。上限「10 秒 3 件」が実サーバで守られることは、同一クライアントキーを共有する 6 つの browser context を同時に参加操作させ、画面の成功数・エラー数・一覧の増分を数える Playwright のブラウザテスト（5.5）で担保する。`tests/app.spec.ts` では **API のレスポンスを合否判定に使わない**。このファイルはブラウザ挙動用で、API/ロジックそのものの検証先は `tests/unit/*.test.ts` である（開始時点の番号・件数を得る `GET /api/entries` は準備手順として使ってよい）。

### 5.1 テスト環境の前提

- **クライアント識別ヘッダは必ず明示する**。実測のとおりローカル `wrangler dev` はクライアントが送った `CF-Connecting-IP` をそのまま Worker に渡すが、**送らない場合は `127.0.0.1` が自動で付く**。指定を省くと全テストが同一クライアント扱いになり、レートリミットが相互干渉して不安定になる
- `client_key` はサーバから見ればただの文字列なので任意の値でよい。ローカル D1 は `npm test` の実行をまたいで残り、レート窓は 10 秒あるため、**実行ごとに一意なキー**を使う。`tests/app.spec.ts` の先頭で `const RUN = Date.now().toString(36)` を作り、各テストに `2001:db8:${RUN}::<テスト固有の番号>` を割り当てる（10 秒以内に再実行しても前回の窓が残らない）
- ブラウザ経由の並行参加は「`browser.newContext({ extraHTTPHeaders: { "CF-Connecting-IP": <キー> } })` で複数の context を作り、`Promise.all` で各画面の「参加する」を同時クリックする」形で実現する。context に付けたヘッダはページ内 `fetch` の `POST /api/entries` にも乗るため、これで各画面のクライアント識別を制御できる
- 採番の並行検証（AC1）は**キーを別々に**した 5 context、レートリミットの並行検証（AC4）は**キーを共有**した 6 context と、同じ仕組みでキーの配り方だけを変える
- ローカル D1 の内容は実行をまたいで残る。**どのテストも番号や人数の絶対値に依存させず**、テスト開始時点の `total` と最大番号を `GET /api/entries` で取得したうえで、そこからの増分で判定する（一覧は全件返すため、行数が増えてもこの前提は壊れない）
- 増分での判定は「同時に走る他のテストが行を追加しない」ことに依存する。ブラウザテストは `tests/app.spec.ts` 1 ファイルに集約し、`fullyParallel` を有効にしない（Playwright の既定どおり同一ファイル内は直列実行）

### 5.2 AC1 連番採番

- `tests/app.spec.ts` `AC1: 参加すると連番の整理券番号が表示され、同時参加でも重複しない`（`test.describe.serial`）
  - 参加前の最大番号 `max` を `GET /api/entries` で取得する
  - 直列: 3 つの独立 context（別キー）で順に「たろう」「はなこ」「じろう」を参加 → 各画面の `my-position` が `あなたの整理券番号は {max+1} 番です` / `{max+2}` / `{max+3}`、一覧の末尾 3 行の `entry-row` テキストが `["{max+1} 番 たろう","{max+2} 番 はなこ","{max+3} 番 じろう"]` と一致
  - 並行: 続けて 5 つの context（別キー）で `Promise.all` により同時クリック → 5 画面の `my-position` から抽出した番号を昇順に並べた配列が `[max+4, max+5, max+6, max+7, max+8]` と一致（重複も欠番もない）し、一覧の `entry-row` が 5 行増える
- `tests/unit/entries.test.ts` `POST /api/entries は INSERT ... RETURNING の position をそのまま返す`
  - フェイク D1 が `RETURNING` で返した `position` が 201 レスポンスの `entry.position` に一致する
  - 発行される SQL に `MAX(` を含まないこと（read-modify-write 採番の混入を防ぐ回帰テスト）

### 5.3 AC2 全員が同じ一覧

- `tests/app.spec.ts` `AC2: 別セッションでも同じ順位一覧が見える`
  - context A（キー a）で 2 名参加させる → context A の `entry-row` 全テキスト配列と `total` テキストを取得
  - context B（新規 context、別キー、localStorage 空）で `/` を開く → `entry-row` 全テキスト配列と `total` テキストが A と完全一致（`toEqual`）
  - 両 context で `entry-row` の件数が `total` の数値と一致すること（一覧が途中で切れていない）
  - context B では `my-position` が表示されないこと（未参加セッションに自分の番号が漏れない）
- `tests/unit/entries.test.ts` `GET /api/entries は件数上限なしで全件を position 昇順に返す`
  - ブラウザテストは現実的な行数しか作れず「全員」の欠落を検出できないため、大量件数はここで担保する。フェイク D1 に 1500 行返させ、レスポンスの `entries` が 1500 件（先頭と末尾の `position` まで一致）、`total` が 1500 であること — 件数上限を入れると落ちる
  - 発行される SQL が `ORDER BY position ASC` を含み、`LIMIT` を含まないこと（上限の再混入を防ぐ回帰テスト）
  - `total` が `entries.length` と常に等しいこと（`COUNT(*)` の別文に戻すと食い違いうる）

### 5.4 AC3 匿名 + 入力バリデーション

- `tests/app.spec.ts` `AC3: 名前だけで参加でき、空と 25 文字は拒否され 24 文字は通る`
  - フォーム内の `input` が 1 つだけであること（`form input` の count が 1）、パスワード欄・メール欄・ログイン導線が存在しないこと
  - 空文字で送信 → `form-error` に `名前を入力してください`、`total` の数値が送信前と同じ
  - 25 文字（`"あ".repeat(25)`）で送信 → `form-error` に `名前は 24 文字までです`、`total` が不変
  - 24 文字（`"あ".repeat(24)`）で送信 → `my-position` に番号が表示され、`total` が 1 増え、一覧の最終行に 24 文字の名前がそのまま表示される
  - 送信前後で `document.cookie` が空であること（認証・セッションを持たない）
- `tests/unit/entries.test.ts` `POST /api/entries の入力上限`
  - name 24 文字 → 201、25 文字 → 400 `invalid_name`、`"   "`（空白のみ）→ 400、`name` が数値 → 400
  - ボディ 1024 バイト → バリデーションに進む、1025 バイト → 413 `too_large`

### 5.5 AC4 レートリミット（時間窓の境界）

- `tests/app.spec.ts` `AC4: 10 秒に 3 件まで許可し 4 件目を拒否、10 秒経過後に再開`（UI 経由・逐次）
  - 単一 context（固有キー）で 3 回連続参加 → 3 回とも `my-position` が更新され、`total` が 3 増える（ちょうど 3 件目＝許可の境界）
  - 続けて 4 回目を送信 → `form-error` に `参加が集中しています。10 秒ほど待って再度お試しください`、`total` が不変、`my-position` は 3 件目の番号のまま
  - `page.waitForTimeout(10_500)` で時間窓（10 秒）を跨いだのち再送信 → 成功して `total` が 1 増え、`my-position` が更新される
- `tests/app.spec.ts` `AC4: 同一クライアントキーの 6 セッションが同時参加しても成功はちょうど 3 件`（UI 経由・並行）
  - 観測用 context（別キー）で `/` を開き、参加前の `total` の数値と `entry-row` の件数を記録する
  - **同一の** `CF-Connecting-IP`（実行ごとに一意なキー）を `extraHTTPHeaders` に設定した browser context を 6 つ作り、各ページで `/` を開いて `name-input` に `並行1`〜`並行6` を入力しておく。ロードと入力をクリック前に済ませ、6 本の POST を同じ 10 秒窓に確実に収める
  - `Promise.all` で 6 画面の `join-button` を同時クリック
  - 各画面が `my-position` 表示 / `form-error` 表示のいずれかに落ち着くのを待って内訳を数える → `my-position` に番号が出た画面がちょうど 3、`form-error` が `参加が集中しています。10 秒ほど待って再度お試しください` の画面がちょうど 3
  - 成功した 3 画面の `my-position` から抽出した番号が互いに重複しないこと
  - 観測用 context をリロード → `total` の数値が参加前 +3 ちょうど、`entry-row` の件数も +3 ちょうどで、増えた 3 行の `N 番 並行X` が成功した 3 画面の番号・名前と一致する（4 件目以降が DB に入っていない）
  - 「成功 3・エラー 3・増分 3」は逐次でも並行でも同じ期待値なのでアサーションは安定する。判定と挿入を 2 文に分けた実装では 6 本が同じ `COUNT` を読んで 4 件以上通り、この等値が崩れて落ちる。ただしブラウザ操作が逐次化されれば素通りしうるため、SQL が 1 文であること自体は下の vitest で固定する
- `tests/unit/entries.test.ts` `レートリミット判定は単一の条件付き INSERT で行う`
  - `vi.setSystemTime` でサーバ時刻を固定し、フェイク D1 が受け取った SQL 文字列と `bind` の実値を検証する
  - 発行される SQL が 1 文で、`INSERT` / `SELECT COUNT(*)` / `RETURNING` を同時に含むこと（判定と挿入が別文に分かれていないことの回帰テスト）
  - `bind` の窓下限が `now - 10000` ちょうどで、比較演算子が `>`（＝ `created_at === now - 10000` の行は数えない、`now - 9999` の行は数える）、上限値が `3` であること
  - フェイク D1 の `first()` が行を返す → 201 と `entry.position`、`null` を返す → 429 とボディ `{"error":"rate_limited","retryAfterSec":10}`
- `tests/unit/entries.test.ts` `client_key の解決順`
  - `CF-Connecting-IP` があればそれを使う / なければ `X-Forwarded-For` の先頭 / どちらも無ければ `"unknown"`
  - 別々の `client_key` が同じ窓を共有しないこと（`bind` に渡る `client_key` がヘッダの値そのものであること）

### 5.6 AC5 API 不達でも骨格が出る

- `tests/app.spec.ts` `AC5: file:// でもタイトルとフッターが描画される`
  - `page.on("pageerror")` を仕掛けたうえで `file://<repo>/public/index.html` を開く
  - `h1` のテキストが `先着順ウェイトリスト`、`a[href="https://apps.jozo.beer"]` のテキストが `apps.jozo.beer` で可視
  - `pageerror` が 0 件（`fetch` 失敗が未処理例外にならない）
  - 一覧領域に `list-error` の `一覧を取得できませんでした` が表示され、白画面にならないこと

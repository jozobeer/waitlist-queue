import { useState, type FormEvent } from "react";
import { createRoom } from "./api";

export function Home() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("受付名を入力してください");
      return;
    }
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const result = await createRoom(trimmed);
    if (!result.ok) {
      setError(result.error);
      setSubmitting(false);
      return;
    }
    location.hash = "#/r/" + result.id;
    setSubmitting(false);
  }

  return (
    <>
      <p className="lede">
        受付を作ると共有URLが発行されます。そのURLを知る人だけが、同じ待ち行列に並べます。
      </p>
      <form className="join-form" onSubmit={(event) => void handleCreate(event)}>
        <label htmlFor="room-name-input">受付名</label>
        <div className="join-row">
          <input
            id="room-name-input"
            name="name"
            type="text"
            maxLength={40}
            value={name}
            onChange={(event) => setName(event.target.value)}
            data-testid="room-name-input"
            autoComplete="off"
            placeholder="窓口A"
            disabled={submitting}
          />
          <button type="submit" data-testid="create" disabled={submitting}>
            作成
          </button>
        </div>
        {error ? (
          <p role="alert" data-testid="create-error">
            {error}
          </p>
        ) : null}
      </form>
      <section className="help" id="how-to" aria-labelledby="how-to-heading">
        <h2 id="how-to-heading">使い方</h2>
        <ol>
          <li>受付名を入力して「作成」を押す</li>
          <li>表示された共有URLを、並びたい人に渡す</li>
          <li>名前を入れて「参加する」と、その受付の整理券番号が発行される</li>
          <li>同じURLを開いた人だけが、同じ順番の一覧を見られる</li>
        </ol>
      </section>
      <section className="help" id="faq" aria-labelledby="faq-heading">
        <h2 id="faq-heading">FAQ</h2>
        <dl>
          <dt>整理券番号はどこで確認できますか？</dt>
          <dd>
            参加すると画面上部に「あなたの整理券番号は N 番です」と出ます。同じブラウザなら再訪時も残ります。番号は受付ごとに 1 から始まります。
          </dd>
          <dt>別の受付の列は見えませんか？</dt>
          <dd>見えません。共有URLを知っている人だけが、同じ受付の待ち行列を見ます。</dd>
          <dt>連続して何回でも参加できますか？</dt>
          <dd>同じ接続元からは、その受付につき 10 秒に 3 件までです。超えると少し待ってから再度参加できます。</dd>
        </dl>
      </section>
    </>
  );
}

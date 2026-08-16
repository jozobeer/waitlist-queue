import { useEffect, useState } from "react";
import { fetchEntries, joinWaitlist, type QueueEntry } from "./api";
import { JoinForm } from "./JoinForm";
import { QueueList } from "./QueueList";

const POSITION_KEY = "waitlist.myPosition";

function readStoredPosition(): number | null {
  try {
    const raw = localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function storePosition(position: number) {
  try {
    localStorage.setItem(POSITION_KEY, String(position));
  } catch {
    // ストレージ拒否でも番号カード以外は描画し続ける
  }
}

function clientNameError(name: string): string | null {
  const cleaned = name.replace(/[\u0000-\u001F]/g, "").trim();
  if (cleaned.length === 0) return "名前を入力してください";
  if (Array.from(cleaned).length > 24) return "名前は 24 文字までです";
  return null;
}

export function App() {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [myPosition, setMyPosition] = useState<number | null>(readStoredPosition);
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchEntries().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setEntries(result.entries);
        setTotal(result.total);
        setListError(null);
      } else {
        setListError("一覧を取得できませんでした");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleJoin(name: string) {
    const localError = clientNameError(name);
    if (localError) {
      setFormError(localError);
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    const result = await joinWaitlist(name);
    if (!result.ok) {
      setFormError(result.error);
      setSubmitting(false);
      return;
    }
    setMyPosition(result.entry.position);
    storePosition(result.entry.position);
    const listed = await fetchEntries();
    if (listed.ok) {
      setEntries(listed.entries);
      setTotal(listed.total);
      setListError(null);
    } else {
      setListError("一覧を取得できませんでした");
    }
    setSubmitting(false);
  }

  return (
    <main className="app">
      <h1>先着順ウェイトリスト</h1>
      <p className="lede">
        名前を入れて参加すると、先着順の整理券番号が発行されます。全員が同じ一覧を見られます。
      </p>
      {myPosition != null ? (
        <p className="ticket" data-testid="my-position">
          あなたの整理券番号は {myPosition} 番です
        </p>
      ) : null}
      <JoinForm onJoin={handleJoin} submitting={submitting} error={formError} />
      <QueueList entries={entries} total={total} listError={listError} />
    </main>
  );
}

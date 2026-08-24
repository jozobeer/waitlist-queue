import { useEffect, useState } from "react";
import { fetchRoom, joinWaitlist, type QueueEntry } from "./api";
import { JoinForm } from "./JoinForm";
import { QueueList } from "./QueueList";

const COPIED_MESSAGE = "コピーしました";
const COPY_FAIL_MESSAGE = "コピーできませんでした。URL を選択してコピーしてください";
const NOT_FOUND_MESSAGE = "この受付は見つかりませんでした";

function positionKey(roomId: string): string {
  return `waitlist.myPosition.${roomId}`;
}

function readStoredPosition(roomId: string): number | null {
  try {
    const raw = localStorage.getItem(positionKey(roomId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function storePosition(roomId: string, position: number) {
  try {
    localStorage.setItem(positionKey(roomId), String(position));
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

export function Room({ roomId }: { roomId: string }) {
  const [roomName, setRoomName] = useState("");
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [myPosition, setMyPosition] = useState<number | null>(() => readStoredPosition(roomId));
  const [listError, setListError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const shareUrl = `${location.origin}/#/r/${roomId}`;

  useEffect(() => {
    let cancelled = false;
    fetchRoom(roomId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setRoomName(result.room.name);
        setEntries(result.room.entries);
        setTotal(result.room.total);
        setListError(null);
        return;
      }
      if (result.notFound) {
        setNotFound(true);
        return;
      }
      setListError("一覧を取得できませんでした");
    });
    return () => {
      cancelled = true;
    };
  }, [roomId]);

  async function handleJoin(name: string) {
    const localError = clientNameError(name);
    if (localError) {
      setFormError(localError);
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setFormError(null);
    const result = await joinWaitlist(roomId, name);
    if (!result.ok) {
      setFormError(result.error);
      setSubmitting(false);
      return;
    }
    setMyPosition(result.entry.position);
    storePosition(roomId, result.entry.position);
    const listed = await fetchRoom(roomId);
    if (listed.ok) {
      setRoomName(listed.room.name);
      setEntries(listed.room.entries);
      setTotal(listed.room.total);
      setListError(null);
    } else if (listed.notFound) {
      setNotFound(true);
    } else {
      setListError("一覧を取得できませんでした");
    }
    setSubmitting(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(COPIED_MESSAGE);
    } catch {
      setCopied(COPY_FAIL_MESSAGE);
    }
  }

  if (notFound) {
    return (
      <p className="not-found" data-testid="not-found">
        {NOT_FOUND_MESSAGE}
      </p>
    );
  }

  return (
    <>
      <p className="room-name" data-testid="room-name">
        {roomName}
      </p>
      {myPosition != null ? (
        <p className="ticket" data-testid="my-position">
          あなたの整理券番号は {myPosition} 番です
        </p>
      ) : null}
      <JoinForm onJoin={handleJoin} submitting={submitting} error={formError} />
      <QueueList entries={entries} total={total} listError={listError} />
      <div className="share">
        <p className="share-url" data-testid="share-url">
          {shareUrl}
        </p>
        <button type="button" className="copy" data-testid="copy" onClick={() => void copy()}>
          コピー
        </button>
        <p className="copied" data-testid="copied">
          {copied ?? ""}
        </p>
      </div>
    </>
  );
}

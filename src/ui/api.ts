export type QueueEntry = {
  position: number;
  name: string;
  createdAt: number;
};

export type RoomPayload = {
  id: string;
  name: string;
  entries: QueueEntry[];
  total: number;
};

const CREATE_FAIL = "受付を作成できませんでした。もう一度お試しください";

function errorMessage(code: string): string {
  if (code === "rate_limited") {
    return "参加が集中しています。10 秒ほど待って再度お試しください";
  }
  if (code === "invalid_name") return "名前を入力してください";
  if (code === "too_large") return "名前は 24 文字までです";
  return "参加できませんでした";
}

export async function createRoom(
  name: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.status === 429) {
      return { ok: false, error: "混み合っています。少し待ってから作成してください" };
    }
    if (!res.ok) return { ok: false, error: CREATE_FAIL };
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return { ok: false, error: CREATE_FAIL };
    const id = (data as { id?: unknown }).id;
    if (typeof id !== "string" || id.length === 0) return { ok: false, error: CREATE_FAIL };
    return { ok: true, id };
  } catch {
    return { ok: false, error: CREATE_FAIL };
  }
}

export async function fetchRoom(
  id: string,
): Promise<{ ok: true; room: RoomPayload } | { ok: false; notFound: boolean }> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(id)}`);
    if (res.status === 404) return { ok: false, notFound: true };
    if (!res.ok) return { ok: false, notFound: false };
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return { ok: false, notFound: false };
    const rec = data as { id?: unknown; name?: unknown; entries?: unknown; total?: unknown };
    if (typeof rec.id !== "string" || typeof rec.name !== "string") return { ok: false, notFound: false };
    if (!Array.isArray(rec.entries) || typeof rec.total !== "number") return { ok: false, notFound: false };
    return {
      ok: true,
      room: { id: rec.id, name: rec.name, entries: rec.entries as QueueEntry[], total: rec.total },
    };
  } catch {
    return { ok: false, notFound: false };
  }
}

export async function joinWaitlist(
  roomId: string,
  name: string,
): Promise<{ ok: true; entry: QueueEntry } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data: unknown = await res.json();
    if (!res.ok) {
      const rec = data && typeof data === "object" ? (data as { error?: unknown }) : {};
      const code = typeof rec.error === "string" ? rec.error : "failed";
      return { ok: false, error: errorMessage(code) };
    }
    if (!data || typeof data !== "object" || !("entry" in data)) {
      return { ok: false, error: "参加できませんでした" };
    }
    return { ok: true, entry: (data as { entry: QueueEntry }).entry };
  } catch {
    return { ok: false, error: "参加できませんでした" };
  }
}

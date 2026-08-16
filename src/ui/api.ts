export type QueueEntry = {
  position: number;
  name: string;
  createdAt: number;
};

function errorMessage(code: string): string {
  if (code === "rate_limited") {
    return "参加が集中しています。10 秒ほど待って再度お試しください";
  }
  if (code === "invalid_name") return "名前を入力してください";
  if (code === "too_large") return "名前は 24 文字までです";
  return "参加できませんでした";
}

export async function fetchEntries(): Promise<
  { ok: true; entries: QueueEntry[]; total: number } | { ok: false }
> {
  try {
    const res = await fetch("/api/entries");
    if (!res.ok) return { ok: false };
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return { ok: false };
    const rec = data as { entries?: unknown; total?: unknown };
    if (!Array.isArray(rec.entries) || typeof rec.total !== "number") return { ok: false };
    return { ok: true, entries: rec.entries as QueueEntry[], total: rec.total };
  } catch {
    return { ok: false };
  }
}

export async function joinWaitlist(
  name: string,
): Promise<{ ok: true; entry: QueueEntry } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/entries", {
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

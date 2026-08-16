import type { QueueEntry } from "./api";

type Props = {
  entries: QueueEntry[];
  total: number;
  listError: string | null;
};

export function QueueList({ entries, total, listError }: Props) {
  return (
    <section className="queue">
      <h2 data-testid="total">現在 {total} 人が参加中</h2>
      {listError ? (
        <p data-testid="list-error">一覧を取得できませんでした</p>
      ) : entries.length === 0 ? (
        <p className="empty">まだ誰も参加していません</p>
      ) : (
        <ol className="queue-list">
          {entries.map((entry) => (
            <li
              key={entry.position}
              data-testid="entry-row"
              data-position={entry.position}
            >
              {entry.position} 番 {entry.name}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

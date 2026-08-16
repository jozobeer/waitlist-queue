CREATE TABLE IF NOT EXISTS entries (
  position   INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  client_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_client ON entries(client_key, created_at);

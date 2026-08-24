CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rooms_client ON rooms(client_key, created_at);

ALTER TABLE entries ADD COLUMN room_id TEXT REFERENCES rooms(id);
CREATE INDEX IF NOT EXISTS idx_entries_room ON entries(room_id, position);

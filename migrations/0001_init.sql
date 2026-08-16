-- 初期スキーマ。health が参照する app_meta テーブルは削除しないこと。
-- スキーマ変更は新しい連番の migration ファイル（0002_〜）を追加して行う。
-- 適用済み migration ファイルの書き換えは禁止（ローカルとリモートの適用履歴が壊れる）
CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);

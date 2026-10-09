CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT NOT NULL CHECK (section IN ('announcements', 'schedule', 'resources', 'activities')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  day INTEGER,
  start_time TEXT,
  end_time TEXT,
  location TEXT,
  url TEXT,
  category TEXT,
  date TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS entries_section_idx ON entries(section);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO settings(key, value) VALUES ('contact_text', 'pls contact rara via WA group');
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (client_hash TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL);

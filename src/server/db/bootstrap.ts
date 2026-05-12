import type Database from "better-sqlite3";

function hasColumn(sqlite: Database.Database, tableName: string, columnName: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name?: string;
  }>;

  return columns.some((column) => column.name === columnName);
}

export function ensureSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      device_token TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      preferred_locale TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      host_profile_id TEXT,
      locale TEXT NOT NULL,
      theme_id TEXT,
      custom_theme TEXT,
      rotation_mode INTEGER NOT NULL DEFAULT 0,
      lock_queue INTEGER NOT NULL DEFAULT 0,
      active_queue_item_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_participants (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      is_present INTEGER NOT NULL DEFAULT 1
    );

    CREATE UNIQUE INDEX IF NOT EXISTS room_participants_room_profile_idx
      ON room_participants (room_id, profile_id);
    CREATE INDEX IF NOT EXISTS room_participants_room_idx
      ON room_participants (room_id);

    CREATE TABLE IF NOT EXISTS songs (
      id TEXT PRIMARY KEY,
      youtube_video_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      channel_title TEXT NOT NULL,
      thumbnail_url TEXT NOT NULL,
      duration_label TEXT,
      language_hint TEXT,
      embeddable INTEGER NOT NULL DEFAULT 1,
      deleted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS queue_items (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      song_id TEXT NOT NULL,
      added_by_profile_id TEXT NOT NULL,
      primary_singer_profile_id TEXT NOT NULL,
      secondary_singer_profile_id TEXT,
      position INTEGER NOT NULL,
      status TEXT NOT NULL,
      added_at TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT
    );

    CREATE INDEX IF NOT EXISTS queue_items_room_queue_idx
      ON queue_items (room_id, position);
    CREATE INDEX IF NOT EXISTS queue_items_room_status_idx
      ON queue_items (room_id, status);

    CREATE TABLE IF NOT EXISTS favorites (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      song_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS favorites_profile_song_idx
      ON favorites (profile_id, song_id);

    CREATE TABLE IF NOT EXISTS playback_history (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      queue_item_id TEXT NOT NULL,
      song_id TEXT NOT NULL,
      primary_singer_profile_id TEXT NOT NULL,
      secondary_singer_profile_id TEXT,
      outcome TEXT NOT NULL,
      completed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS playback_history_room_idx
      ON playback_history (room_id, completed_at);

    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      queue_item_id TEXT,
      emoji TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS reactions_room_idx
      ON reactions (room_id, created_at);

    CREATE TABLE IF NOT EXISTS encore_votes (
      id TEXT PRIMARY KEY,
      history_id TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS encore_votes_history_profile_idx
      ON encore_votes (history_id, profile_id);

    CREATE TABLE IF NOT EXISTS search_cache (
      id TEXT PRIMARY KEY,
      query_key TEXT NOT NULL,
      locale TEXT NOT NULL,
      results_json TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS search_cache_query_locale_idx
      ON search_cache (query_key, locale);
  `);

  if (!hasColumn(sqlite, "songs", "deleted_at")) {
    sqlite.exec("ALTER TABLE songs ADD COLUMN deleted_at TEXT");
  }
}

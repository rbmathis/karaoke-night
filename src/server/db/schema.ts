import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: text("id").primaryKey(),
  deviceToken: text("device_token").notNull().unique(),
  displayName: text("display_name").notNull(),
  preferredLocale: text("preferred_locale").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    hostProfileId: text("host_profile_id"),
    locale: text("locale").notNull(),
    themeId: text("theme_id"),
    customTheme: text("custom_theme"),
    rotationMode: integer("rotation_mode", { mode: "boolean" })
      .notNull()
      .default(false),
    lockQueue: integer("lock_queue", { mode: "boolean" }).notNull().default(false),
    activeQueueItemId: text("active_queue_item_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    codeIdx: uniqueIndex("rooms_code_idx").on(table.code),
  }),
);

export const roomParticipants = sqliteTable(
  "room_participants",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    profileId: text("profile_id").notNull(),
    joinedAt: text("joined_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
    isPresent: integer("is_present", { mode: "boolean" }).notNull().default(true),
  },
  (table) => ({
    roomProfileUnique: uniqueIndex("room_participants_room_profile_idx").on(
      table.roomId,
      table.profileId,
    ),
    roomIdx: index("room_participants_room_idx").on(table.roomId),
  }),
);

export const songs = sqliteTable(
  "songs",
  {
    id: text("id").primaryKey(),
    youtubeVideoId: text("youtube_video_id").notNull(),
    title: text("title").notNull(),
    channelTitle: text("channel_title").notNull(),
    thumbnailUrl: text("thumbnail_url").notNull(),
    durationLabel: text("duration_label"),
    languageHint: text("language_hint"),
    embeddable: integer("embeddable", { mode: "boolean" }).notNull().default(true),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    youtubeVideoUnique: uniqueIndex("songs_youtube_video_idx").on(table.youtubeVideoId),
  }),
);

export const queueItems = sqliteTable(
  "queue_items",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    songId: text("song_id").notNull(),
    addedByProfileId: text("added_by_profile_id").notNull(),
    primarySingerProfileId: text("primary_singer_profile_id").notNull(),
    secondarySingerProfileId: text("secondary_singer_profile_id"),
    position: integer("position").notNull(),
    status: text("status").notNull(),
    addedAt: text("added_at").notNull(),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
  },
  (table) => ({
    roomQueueIdx: index("queue_items_room_queue_idx").on(table.roomId, table.position),
    roomStatusIdx: index("queue_items_room_status_idx").on(table.roomId, table.status),
  }),
);

export const favorites = sqliteTable(
  "favorites",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id").notNull(),
    songId: text("song_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    favoriteUnique: uniqueIndex("favorites_profile_song_idx").on(
      table.profileId,
      table.songId,
    ),
  }),
);

export const playbackHistory = sqliteTable(
  "playback_history",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    queueItemId: text("queue_item_id").notNull(),
    songId: text("song_id").notNull(),
    primarySingerProfileId: text("primary_singer_profile_id").notNull(),
    secondarySingerProfileId: text("secondary_singer_profile_id"),
    outcome: text("outcome").notNull(),
    completedAt: text("completed_at").notNull(),
  },
  (table) => ({
    roomHistoryIdx: index("playback_history_room_idx").on(table.roomId, table.completedAt),
  }),
);

export const reactions = sqliteTable(
  "reactions",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull(),
    profileId: text("profile_id").notNull(),
    queueItemId: text("queue_item_id"),
    emoji: text("emoji").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    roomReactionsIdx: index("reactions_room_idx").on(table.roomId, table.createdAt),
  }),
);

export const encoreVotes = sqliteTable(
  "encore_votes",
  {
    id: text("id").primaryKey(),
    historyId: text("history_id").notNull(),
    profileId: text("profile_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => ({
    historyProfileUnique: uniqueIndex("encore_votes_history_profile_idx").on(
      table.historyId,
      table.profileId,
    ),
  }),
);

export const searchCache = sqliteTable(
  "search_cache",
  {
    id: text("id").primaryKey(),
    queryKey: text("query_key").notNull(),
    locale: text("locale").notNull(),
    resultsJson: text("results_json").notNull(),
    expiresAt: text("expires_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    queryLocaleUnique: uniqueIndex("search_cache_query_locale_idx").on(
      table.queryKey,
      table.locale,
    ),
  }),
);

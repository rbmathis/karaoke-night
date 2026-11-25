import { z } from "zod";

import { PARTY_THEMES } from "@/lib/constants";
import { SUPPORTED_LOCALES } from "@/lib/locale";

export const localeSchema = z.enum(SUPPORTED_LOCALES);

export const createRoomSchema = z.object({
  displayName: z.string().trim().min(2).max(24),
  roomName: z.string().trim().min(0).max(48).optional(),
  locale: localeSchema.default("en"),
});

export const joinRoomSchema = z.object({
  code: z.string().trim().min(4).max(8),
  displayName: z.string().trim().min(2).max(24),
  avatarId: z.string().trim().min(1).max(16).optional(),
  locale: localeSchema.default("en"),
});

export const songInputSchema = z.object({
  youtubeVideoId: z.string().trim().min(5).max(32),
  title: z.string().trim().min(1).max(200),
  channelTitle: z.string().trim().min(1).max(160),
  thumbnailUrl: z.string().trim().url(),
  durationLabel: z.string().trim().max(32).optional(),
  languageHint: z.string().trim().max(16).optional(),
});

export const roomActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heartbeat"),
  }),
  z.object({
    type: z.literal("update-singer"),
    displayName: z.string().trim().min(2).max(24),
    avatarId: z.string().trim().min(1).max(16),
  }),
  z.object({
    type: z.literal("claim-host"),
  }),
  z.object({
    type: z.literal("make-host"),
    profileId: z.string().min(1),
  }),
  z.object({
    type: z.literal("add-queue-item"),
    song: songInputSchema,
    primarySingerId: z.string().min(1).optional(),
    secondarySingerId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("remove-queue-item"),
    queueItemId: z.string().min(1),
  }),
  z.object({
    type: z.literal("reorder-queue"),
    queueItemIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    type: z.literal("rebalance-queue"),
  }),
  z.object({
    type: z.literal("start-playback"),
    queueItemId: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("advance-playback"),
    outcome: z.enum(["played", "skipped"]),
  }),
  z.object({
    type: z.literal("update-settings"),
    themeId: z
      .enum(PARTY_THEMES.map((theme) => theme.id) as [string, ...string[]])
      .nullable()
      .optional(),
    customTheme: z.string().trim().max(48).nullable().optional(),
  }),
  z.object({
    type: z.literal("toggle-favorite"),
    song: songInputSchema,
  }),
  z.object({
    type: z.literal("add-reaction"),
    emoji: z.string().trim().min(1).max(4),
  }),
  z.object({
    type: z.literal("toggle-encore-vote"),
    historyId: z.string().min(1),
  }),
  z.object({
    type: z.literal("delete-room"),
  }),
  z.object({
    type: z.literal("report-playback-error"),
    youtubeVideoId: z.string().trim().min(5).max(32),
    errorCode: z.number().int(),
  }),
  z.object({
    type: z.literal("report-playback-success"),
    youtubeVideoId: z.string().trim().min(5).max(32),
  }),
  z.object({
    type: z.literal("swap-current-song"),
  }),
]);

export const youtubeSearchSchema = z.object({
  q: z.string().trim().min(1).max(120),
  locale: localeSchema.default("en"),
  pageToken: z.string().trim().min(1).max(64).optional(),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type JoinRoomInput = z.infer<typeof joinRoomSchema>;
export type SongInput = z.infer<typeof songInputSchema>;
export type RoomActionInput = z.infer<typeof roomActionSchema>;
export type YouTubeSearchInput = z.infer<typeof youtubeSearchSchema>;

export type PersonSummary = {
  id: string;
  displayName: string;
  avatarId: string;
  isHost?: boolean;
  isPresent?: boolean;
};

export type SongView = {
  id: string;
  youtubeVideoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationLabel: string | null;
  languageHint: string | null;
};

export type QueueItemView = {
  id: string;
  position: number;
  status: "queued" | "playing";
  addedAt: string;
  addedByDisplayName: string;
  primarySinger: PersonSummary;
  secondarySinger: PersonSummary | null;
  song: SongView;
};

export type HistoryItemView = {
  id: string;
  outcome: "played" | "skipped";
  completedAt: string;
  encoreVotes: number;
  viewerVoted: boolean;
  primarySinger: PersonSummary;
  secondarySinger: PersonSummary | null;
  song: SongView;
};

export type ReactionView = {
  id: string;
  emoji: string;
  createdAt: string;
  byDisplayName: string;
};

export type ThemePresetView = {
  id: string;
  name: string;
  description: string;
  searchHint: string;
};

export type RoomState = {
  room: {
    id: string;
    code: string;
    name: string;
    locale: "en" | "ja";
    themeId: string | null;
    customTheme: string | null;
  };
  viewer: {
    profileId: string | null;
    displayName: string | null;
    avatarId: string;
    isHost: boolean;
    isJoined: boolean;
    canClaimHost: boolean;
  };
  participants: Array<PersonSummary & { lastSeenAt: string }>;
  current: QueueItemView | null;
  queue: QueueItemView[];
  history: HistoryItemView[];
  favorites: SongView[];
  recentReactions: ReactionView[];
  themePresets: ThemePresetView[];
};

export type SearchResult = SongView & {
  score: number;
  description: string;
  embeddable: boolean;
};

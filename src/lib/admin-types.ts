import { z } from "zod";

import { PARTY_THEMES } from "@/lib/constants";
import { SUPPORTED_LOCALES } from "@/lib/locale";

const adminLocaleSchema = z.enum(SUPPORTED_LOCALES);
const adminThemeSchema = z.enum(PARTY_THEMES.map((theme) => theme.id) as [string, ...string[]]);

export const adminLoginSchema = z.object({
  password: z.string().min(1).max(200),
});

export const adminActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("delete-room"),
    roomId: z.string().min(1),
  }),
  z.object({
    type: z.literal("update-room-settings"),
    roomId: z.string().min(1),
    name: z.string().trim().min(1).max(48),
    locale: adminLocaleSchema,
    themeId: adminThemeSchema.nullable(),
    customTheme: z.string().trim().max(48).nullable().optional(),
  }),
  z.object({
    type: z.literal("remove-participant"),
    roomId: z.string().min(1),
    profileId: z.string().min(1),
  }),
]);

export type AdminParticipantSummary = {
  id: string;
  displayName: string;
  isHost: boolean;
  isPresent: boolean;
  lastSeenAt: string;
};

export type AdminRoomSummary = {
  id: string;
  code: string;
  name: string;
  locale: "en" | "ja";
  themeId: string | null;
  customTheme: string | null;
  createdAt: string;
  updatedAt: string;
  currentSongTitle: string | null;
  participantCount: number;
  queuedCount: number;
  historyCount: number;
  participants: AdminParticipantSummary[];
};

export type AdminState = {
  configured: boolean;
  authenticated: boolean;
  rooms: AdminRoomSummary[];
};

export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type AdminActionInput = z.infer<typeof adminActionSchema>;

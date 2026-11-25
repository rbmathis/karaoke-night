import type { AppLocale } from "@/lib/locale";

export const COOKIE_NAMES = {
  deviceToken: "karaoke-device-token",
  locale: "karaoke-locale",
  adminSession: "karaoke-admin-session",
} as const;

export const ROOM_CODE_LENGTH = 5;
export const PRESENCE_TTL_MS = 2 * 60 * 1000;
export const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RECENT_REACTIONS_LIMIT = 24;
export const HISTORY_LIMIT = 14;

export const CROWD_REACTIONS = ["🎤", "👏", "🔥", "💖", "✨", "🎉"] as const;
export const SINGER_AVATARS = [
  { id: "singer-1", name: "Blue Hoodie Kid" },
  { id: "singer-2", name: "Purple Hoodie Kid" },
  { id: "singer-3", name: "Green Hoodie Teen" },
  { id: "singer-4", name: "Silver-Haired Singer" },
  { id: "singer-5", name: "Orange Cat" },
  { id: "singer-6", name: "Blue Robot" },
  { id: "singer-7", name: "Green Alien" },
  { id: "singer-8", name: "Red Dragon" },
  { id: "singer-9", name: "Pink Ponytail Kid" },
  { id: "singer-10", name: "Golden Pup" },
  { id: "singer-11", name: "Teal Rockstar" },
  { id: "singer-12", name: "Panda Singer" },
  { id: "singer-13", name: "Rainbow Unicorn" },
  { id: "singer-14", name: "Wise Grandpa" },
  { id: "singer-15", name: "Blue Monster" },
  { id: "singer-16", name: "Friendly Ghost" },
  { id: "singer-17", name: "Star Singer" },
  { id: "singer-18", name: "Green Frog" },
  { id: "singer-19", name: "Purple Sunglasses" },
  { id: "singer-20", name: "Wolf Singer" },
  { id: "singer-21", name: "Pink Headphones" },
  { id: "singer-22", name: "Blue Elf" },
  { id: "singer-23", name: "One-Eyed Monster" },
  { id: "singer-24", name: "Yellow Hoodie Kid" },
] as const;

export type ThemePreset = {
  id: string;
  name: Record<AppLocale, string>;
  description: Record<AppLocale, string>;
  searchHint: Record<AppLocale, string>;
};

export const PARTY_THEMES: ThemePreset[] = [
  {
    id: "open-mic",
    name: {
      en: "Open Mix",
      ja: "オープンミックス",
    },
    description: {
      en: "Keep it broad with classic karaoke staples and easy sing-alongs.",
      ja: "定番の人気曲や歌いやすい曲でゆるく楽しむモード。",
    },
    searchHint: {
      en: "karaoke classics",
      ja: "カラオケ 定番",
    },
  },
  {
    id: "anime-night",
    name: {
      en: "Anime Night",
      ja: "アニメナイト",
    },
    description: {
      en: "Queue anisong favorites, anime endings, and dramatic openings.",
      ja: "アニソンやエンディング、熱い主題歌で盛り上がる回。",
    },
    searchHint: {
      en: "anime karaoke",
      ja: "アニソン カラオケ",
    },
  },
  {
    id: "power-ballads",
    name: {
      en: "Power Ballads",
      ja: "パワーバラード",
    },
    description: {
      en: "Belting songs, emotional hooks, and the big chorus moment.",
      ja: "感情を込めて歌える大サビ曲や泣ける名曲向け。",
    },
    searchHint: {
      en: "power ballad karaoke",
      ja: "バラード カラオケ",
    },
  },
  {
    id: "party-pop",
    name: {
      en: "Party Pop",
      ja: "パーティーポップ",
    },
    description: {
      en: "High-energy dance songs and crowd-pleasing hooks.",
      ja: "盛り上がるダンス曲やみんなで歌えるポップ曲。",
    },
    searchHint: {
      en: "party karaoke hits",
      ja: "盛り上がる カラオケ",
    },
  },
];

export const KARAOKE_CHANNEL_HINTS = [
  "Sing King",
  "KaraFun",
  "CoversPH",
  "Stingray Karaoke",
  "Karaoke Hits",
  "Karaoke Version",
  "歌っちゃ王",
  "カラオケ歌っちゃ王",
  "ニコカラ",
];

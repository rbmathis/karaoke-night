import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import { ROOM_CODE_LENGTH } from "@/lib/constants";
import type { AppLocale } from "@/lib/locale";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateRoomCode(length = ROOM_CODE_LENGTH) {
  return Array.from({ length }, () => {
    const index = Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    return ROOM_CODE_ALPHABET[index];
  }).join("");
}

export function createDeviceToken() {
  return crypto.randomUUID();
}

export function normalizeSearchQuery(query: string) {
  return query.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function containsJapaneseCharacters(value: string) {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(value);
}

export function formatTime(isoTimestamp: string, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoTimestamp));
}

export function formatRelativeShort(isoTimestamp: string, locale: AppLocale) {
  const diffMs = new Date(isoTimestamp).getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);

  const rtf = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
  });

  if (Math.abs(diffMinutes) < 60) {
    return rtf.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);

  if (Math.abs(diffHours) < 24) {
    return rtf.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  return rtf.format(diffDays, "day");
}

export function buildLocalePath(locale: AppLocale, path = "") {
  return `/${locale}${path}`;
}

export function parseMaybeJson<T>(value: string | null | undefined, fallback: T) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

const NAMED_HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
};

export function decodeHtmlEntities(value: string) {
  return value
    .replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (match) => NAMED_HTML_ENTITIES[match] ?? match)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

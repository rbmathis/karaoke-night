import "server-only";

import { and, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";

import { KARAOKE_CHANNEL_HINTS, SEARCH_CACHE_TTL_MS } from "@/lib/constants";
import type { SearchResult } from "@/lib/room-types";
import { containsJapaneseCharacters, normalizeSearchQuery } from "@/lib/utils";
import { getDatabase } from "@/server/db/client";
import { searchCache, songs } from "@/server/db/schema";

type YouTubeSearchItem = {
  id?: {
    videoId?: string;
  };
  snippet?: {
    title?: string;
    channelTitle?: string;
    description?: string;
    thumbnails?: {
      medium?: {
        url?: string;
      };
      high?: {
        url?: string;
      };
      default?: {
        url?: string;
      };
    };
  };
};

function buildSearchQuery(query: string, locale: "en" | "ja") {
  const normalized = normalizeSearchQuery(query);
  const alreadyTagged = /(karaoke|カラオケ|off vocal|instrumental)/i.test(normalized);

  if (alreadyTagged) {
    return query;
  }

  if (locale === "ja" || containsJapaneseCharacters(query)) {
    return `${query} カラオケ`;
  }

  return `${query} karaoke`;
}

function scoreSearchResult(
  query: string,
  locale: "en" | "ja",
  item: SearchResult,
) {
  const normalizedQuery = normalizeSearchQuery(query);
  const haystack = normalizeSearchQuery(
    `${item.title} ${item.channelTitle} ${item.description}`,
  );

  let score = 0;

  // Heavily penalize videos that can't be embedded so they only surface when
  // there is no embeddable alternative, rather than being dropped entirely.
  if (!item.embeddable) {
    score -= 1000;
  }

  if (haystack.includes(normalizedQuery)) {
    score += 18;
  }

  if (/(karaoke|カラオケ|off vocal|instrumental|インスト)/i.test(haystack)) {
    score += 45;
  }

  if (/(shorts|live clip|dance practice|cover only)/i.test(haystack)) {
    score -= 18;
  }

  if (
    KARAOKE_CHANNEL_HINTS.some((channelHint) =>
      haystack.includes(normalizeSearchQuery(channelHint)),
    )
  ) {
    score += 30;
  }

  if (locale === "ja" && containsJapaneseCharacters(item.title)) {
    score += 8;
  }

  return score;
}

async function fetchFromYouTube(
  query: string,
  locale: "en" | "ja",
  pageToken?: string,
) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    throw new Error("The YouTube API key is missing. Add YOUTUBE_API_KEY to enable search.");
  }

  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("videoEmbeddable", "true");
  searchUrl.searchParams.set("videoSyndicated", "true");
  searchUrl.searchParams.set("maxResults", "16");
  searchUrl.searchParams.set("q", buildSearchQuery(query, locale));
  searchUrl.searchParams.set("key", apiKey);
  searchUrl.searchParams.set("relevanceLanguage", locale);
  if (pageToken) {
    searchUrl.searchParams.set("pageToken", pageToken);
  }

  const searchResponse = await fetch(searchUrl.toString(), {
    cache: "no-store",
  });

  if (!searchResponse.ok) {
    throw new Error("Could not search YouTube right now.");
  }

  const searchJson = (await searchResponse.json()) as {
    items?: YouTubeSearchItem[];
    nextPageToken?: string;
  };

  const nextPageToken = searchJson.nextPageToken ?? null;

  const videoIds = (searchJson.items ?? [])
    .map((item) => item.id?.videoId)
    .filter((videoId): videoId is string => Boolean(videoId));

  if (videoIds.length === 0) {
    return {
      results: [] as SearchResult[],
      nextPageToken: null as string | null,
    };
  }

  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("part", "contentDetails,status");
  videosUrl.searchParams.set("id", videoIds.join(","));
  videosUrl.searchParams.set("key", apiKey);

  const videosResponse = await fetch(videosUrl.toString(), {
    cache: "no-store",
  });

  if (!videosResponse.ok) {
    throw new Error("Could not inspect YouTube playback details.");
  }

  const videosJson = (await videosResponse.json()) as {
    items?: Array<{
      id?: string;
      contentDetails?: {
        duration?: string;
      };
      status?: {
        embeddable?: boolean;
      };
    }>;
  };

  const byVideoId = new Map(
    (videosJson.items ?? []).map((item) => [
      item.id,
      {
        durationLabel: item.contentDetails?.duration ?? null,
        embeddable: Boolean(item.status?.embeddable),
      },
    ]),
  );

  const results = (searchJson.items ?? [])
    .map((item) => {
      const videoId = item.id?.videoId;

      if (!videoId) {
        return null;
      }

      const status = byVideoId.get(videoId);

      const title = item.snippet?.title?.trim();
      const channelTitle = item.snippet?.channelTitle?.trim();
      const thumbnailUrl =
        item.snippet?.thumbnails?.high?.url ??
        item.snippet?.thumbnails?.medium?.url ??
        item.snippet?.thumbnails?.default?.url;

      if (!title || !channelTitle || !thumbnailUrl) {
        return null;
      }

      const result = {
        id: videoId,
        youtubeVideoId: videoId,
        title,
        channelTitle,
        thumbnailUrl,
        durationLabel: status?.durationLabel ?? null,
        languageHint: locale,
        description: item.snippet?.description?.trim() ?? "",
        embeddable: Boolean(status?.embeddable),
        score: 0,
      } satisfies SearchResult;

      result.score = scoreSearchResult(query, locale, result);
      return result;
    })
    .filter(
      (
        item,
      ): item is {
        id: string;
        youtubeVideoId: string;
        title: string;
        channelTitle: string;
        thumbnailUrl: string;
        durationLabel: string | null;
        languageHint: "en" | "ja";
        description: string;
        embeddable: boolean;
        score: number;
      } => Boolean(item),
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, 12);

  return {
    results,
    nextPageToken,
  };
}

export function markSongEmbedBlocked(youtubeVideoId: string) {
  const { db } = getDatabase();
  const timestamp = new Date().toISOString();

  db.update(songs)
    .set({
      embeddable: false,
      embedBlockedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(songs.youtubeVideoId, youtubeVideoId))
    .run();
}

export function recordSongPlaybackSuccess(youtubeVideoId: string) {
  const { db } = getDatabase();
  const timestamp = new Date().toISOString();

  db.update(songs)
    .set({
      embeddable: true,
      embedBlockedAt: null,
      playSuccessCount: sql`${songs.playSuccessCount} + 1`,
      updatedAt: timestamp,
    })
    .where(eq(songs.youtubeVideoId, youtubeVideoId))
    .run();
}

function applyCatalogPlaybackFilters(results: SearchResult[]) {
  if (results.length === 0) {
    return results;
  }

  const { db } = getDatabase();
  const blockedSongs = db
    .select({
      youtubeVideoId: songs.youtubeVideoId,
    })
    .from(songs)
    .where(
      and(
        inArray(
          songs.youtubeVideoId,
          results.map((result) => result.youtubeVideoId),
        ),
        or(isNotNull(songs.deletedAt), isNotNull(songs.embedBlockedAt)),
      ),
    )
    .all();

  const blockedVideoIds = new Set(blockedSongs.map((song) => song.youtubeVideoId));
  const filtered = results.filter((result) => !blockedVideoIds.has(result.youtubeVideoId));

  if (filtered.length === 0) {
    return filtered;
  }

  const reliableSongs = db
    .select({
      youtubeVideoId: songs.youtubeVideoId,
      channelTitle: songs.channelTitle,
    })
    .from(songs)
    .where(and(gt(songs.playSuccessCount, 0), isNotNull(songs.channelTitle)))
    .all();

  if (reliableSongs.length === 0) {
    return filtered;
  }

  const reliableVideoIds = new Set(reliableSongs.map((song) => song.youtubeVideoId));
  const reliableChannels = new Set(
    reliableSongs.map((song) => normalizeSearchQuery(song.channelTitle)),
  );

  return filtered
    .map((result) => {
      let bonus = 0;

      if (reliableVideoIds.has(result.youtubeVideoId)) {
        bonus += 25;
      }

      if (reliableChannels.has(normalizeSearchQuery(result.channelTitle))) {
        bonus += 12;
      }

      return bonus > 0 ? { ...result, score: result.score + bonus } : result;
    })
    .sort((left, right) => right.score - left.score);
}

export async function searchYouTubeKaraoke(
  query: string,
  locale: "en" | "ja",
  pageToken?: string,
): Promise<{ results: SearchResult[]; nextPageToken: string | null }> {
  if (pageToken) {
    const page = await fetchFromYouTube(query, locale, pageToken);
    return {
      results: applyCatalogPlaybackFilters(page.results),
      nextPageToken: page.nextPageToken,
    };
  }

  const { db } = getDatabase();
  const normalizedQuery = normalizeSearchQuery(query);
  const timestamp = new Date().toISOString();

  const cached =
    db.select()
      .from(searchCache)
      .where(
        and(
          eq(searchCache.queryKey, normalizedQuery),
          eq(searchCache.locale, locale),
          gt(searchCache.expiresAt, timestamp),
        ),
      )
      .get() ?? null;

  if (cached) {
    const parsed = JSON.parse(cached.resultsJson) as
      | SearchResult[]
      | { results: SearchResult[]; nextPageToken: string | null };

    if (Array.isArray(parsed)) {
      return {
        results: applyCatalogPlaybackFilters(parsed),
        nextPageToken: null,
      };
    }

    return {
      results: applyCatalogPlaybackFilters(parsed.results),
      nextPageToken: parsed.nextPageToken ?? null,
    };
  }

  const fetched = await fetchFromYouTube(query, locale);
  const results = applyCatalogPlaybackFilters(fetched.results);
  const expiresAt = new Date(Date.now() + SEARCH_CACHE_TTL_MS).toISOString();

  db.insert(searchCache)
    .values({
      id: crypto.randomUUID(),
      queryKey: normalizedQuery,
      locale,
      resultsJson: JSON.stringify({
        results,
        nextPageToken: fetched.nextPageToken,
      }),
      expiresAt,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [searchCache.queryKey, searchCache.locale],
      set: {
        resultsJson: JSON.stringify({
          results,
          nextPageToken: fetched.nextPageToken,
        }),
        expiresAt,
        updatedAt: timestamp,
      },
    })
    .run();

  return {
    results,
    nextPageToken: fetched.nextPageToken,
  };
}

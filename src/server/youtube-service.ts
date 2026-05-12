import "server-only";

import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";

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

async function fetchFromYouTube(query: string, locale: "en" | "ja") {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    throw new Error("The YouTube API key is missing. Add YOUTUBE_API_KEY to enable search.");
  }

  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("videoEmbeddable", "true");
  searchUrl.searchParams.set("videoSyndicated", "true");
  searchUrl.searchParams.set("maxResults", "12");
  searchUrl.searchParams.set("q", buildSearchQuery(query, locale));
  searchUrl.searchParams.set("key", apiKey);
  searchUrl.searchParams.set("relevanceLanguage", locale);

  const searchResponse = await fetch(searchUrl.toString(), {
    cache: "no-store",
  });

  if (!searchResponse.ok) {
    throw new Error("Could not search YouTube right now.");
  }

  const searchJson = (await searchResponse.json()) as {
    items?: YouTubeSearchItem[];
  };

  const videoIds = (searchJson.items ?? [])
    .map((item) => item.id?.videoId)
    .filter((videoId): videoId is string => Boolean(videoId));

  if (videoIds.length === 0) {
    return [] as SearchResult[];
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

      if (!status?.embeddable) {
        return null;
      }

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
        durationLabel: status.durationLabel,
        languageHint: locale,
        description: item.snippet?.description?.trim() ?? "",
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
        score: number;
      } => Boolean(item),
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);

  return results;
}

function filterDeletedSearchResults(results: SearchResult[]) {
  if (results.length === 0) {
    return results;
  }

  const { db } = getDatabase();
  const deletedSongs = db
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
        isNotNull(songs.deletedAt),
      ),
    )
    .all();

  if (deletedSongs.length === 0) {
    return results;
  }

  const deletedVideoIds = new Set(deletedSongs.map((song) => song.youtubeVideoId));
  return results.filter((result) => !deletedVideoIds.has(result.youtubeVideoId));
}

export async function searchYouTubeKaraoke(
  query: string,
  locale: "en" | "ja",
): Promise<SearchResult[]> {
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
    return filterDeletedSearchResults(JSON.parse(cached.resultsJson) as SearchResult[]);
  }

  const results = filterDeletedSearchResults(await fetchFromYouTube(query, locale));
  const expiresAt = new Date(Date.now() + SEARCH_CACHE_TTL_MS).toISOString();

  db.insert(searchCache)
    .values({
      id: crypto.randomUUID(),
      queryKey: normalizedQuery,
      locale,
      resultsJson: JSON.stringify(results),
      expiresAt,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [searchCache.queryKey, searchCache.locale],
      set: {
        resultsJson: JSON.stringify(results),
        expiresAt,
        updatedAt: timestamp,
      },
    })
    .run();

  return results;
}

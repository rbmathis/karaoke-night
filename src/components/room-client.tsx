"use client";

import {
  ArrowDown,
  ArrowUp,
  Crown,
  Heart,
  Link2,
  Mic2,
  Play,
  RefreshCw,
  Shuffle,
  SkipForward,
  Sparkles,
  Tv2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import YouTube, { type YouTubeEvent } from "react-youtube";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { useI18n } from "@/components/i18n-provider";
import { CROWD_REACTIONS } from "@/lib/constants";
import type { Messages } from "@/lib/dictionaries";
import type {
  QueueItemView,
  RoomActionInput,
  RoomState,
  SearchResult,
  SongView,
} from "@/lib/room-types";
import type { AppLocale } from "@/lib/locale";
import { buildLocalePath, cn, formatRelativeShort, formatTime, parseMaybeJson } from "@/lib/utils";

type RoomMode = "guest" | "host" | "tv";
type GuestSection = "search" | "queue" | "room" | "history";
type PlaybackIssue = {
  code?: number;
  kind: "error" | "stalled";
};

const PLAYBACK_WATCHDOG_MS = 8_000;
const YOUTUBE_UNSTARTED = -1;
const YOUTUBE_PLAYING = 1;
const YOUTUBE_BUFFERING = 3;
const YOUTUBE_MISSING_ERROR = 100;
const YOUTUBE_BLOCKED_ERROR_CODES = new Set([101, 150]);

function Panel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-3xl border border-white/10 bg-slate-950/55 p-5 shadow-2xl shadow-slate-950/45 backdrop-blur",
        className,
      )}
    >
      {children}
    </section>
  );
}

function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/85">
          {eyebrow}
        </p>
      ) : null}
      <h2 className="mt-2 text-lg font-semibold text-white">{title}</h2>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
      ) : null}
    </div>
  );
}

async function readJson<T>(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Something went wrong.");
  }

  return payload as T;
}

function getPlaybackIssueDescription(
  messages: Messages,
  issue: PlaybackIssue,
  isTvMode: boolean,
) {
  if (issue.kind === "error") {
    if (issue.code === YOUTUBE_MISSING_ERROR) {
      return messages.room.playbackMissingHint;
    }

    if (issue.code && YOUTUBE_BLOCKED_ERROR_CODES.has(issue.code)) {
      return messages.room.playbackBlockedHint;
    }
  }

  return isTvMode ? messages.tv.playbackRetryHint : messages.room.playbackUnavailableHint;
}

function EmbeddedCurrentSongPlayer({
  item,
  origin,
  messages,
  isTvMode,
  canSkip,
  actionPending,
  onSkip,
  onPlaybackEnded,
}: {
  item: QueueItemView;
  origin: string;
  messages: Messages;
  isTvMode: boolean;
  canSkip: boolean;
  actionPending: boolean;
  onSkip?: () => void;
  onPlaybackEnded?: () => void;
}) {
  const [issue, setIssue] = useState<PlaybackIssue | null>(null);
  const [playerNonce, setPlayerNonce] = useState(0);
  const watchdogRef = useRef<number | null>(null);
  const hasStartedRef = useRef(false);

  const watchUrl = useMemo(
    () => `https://www.youtube.com/watch?v=${item.song.youtubeVideoId}`,
    [item.song.youtubeVideoId],
  );

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const scheduleWatchdog = useCallback(
    (player: YouTubeEvent["target"]) => {
      if (typeof window === "undefined") {
        return;
      }

      clearWatchdog();
      watchdogRef.current = window.setTimeout(() => {
        void player
          .getPlayerState()
          .then((state: number) => {
            if (
              !hasStartedRef.current &&
              state !== YOUTUBE_PLAYING &&
              state !== YOUTUBE_BUFFERING &&
              state !== YOUTUBE_UNSTARTED
            ) {
              return;
            }

            if (!hasStartedRef.current) {
              setIssue((current) => current ?? { kind: "stalled" });
            }
          })
          .catch(() => undefined);
      }, PLAYBACK_WATCHDOG_MS);
    },
    [clearWatchdog],
  );

  useEffect(() => () => clearWatchdog(), [clearWatchdog]);

  const handleReady = useCallback(
    (event: YouTubeEvent) => {
      hasStartedRef.current = false;
      setIssue(null);
      scheduleWatchdog(event.target);
    },
    [scheduleWatchdog],
  );

  const handleStateChange = useCallback(
    (event: YouTubeEvent<number>) => {
      if (event.data === YOUTUBE_PLAYING) {
        hasStartedRef.current = true;
        clearWatchdog();
        setIssue(null);
      }
    },
    [clearWatchdog],
  );

  const handleError = useCallback(
    (event: YouTubeEvent<number>) => {
      clearWatchdog();
      setIssue({
        kind: "error",
        code: event.data,
      });
    },
    [clearWatchdog],
  );

  const handleRetry = useCallback(() => {
    clearWatchdog();
    hasStartedRef.current = false;
    setIssue(null);
    setPlayerNonce((current) => current + 1);
  }, [clearWatchdog]);

  const playerOptions = useMemo(
    () => ({
      width: "100%",
      height: "100%",
      host: "https://www.youtube-nocookie.com",
      playerVars: {
        autoplay: 1,
        controls: 1,
        rel: 0,
        playsinline: 1,
        enablejsapi: 1,
        ...(origin ? { origin } : {}),
      },
    }),
    [origin],
  );

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-black">
      {issue ? (
        <div className="flex aspect-video flex-col items-center justify-center gap-4 px-6 py-8 text-center">
          {isTvMode ? (
            <Tv2 className="h-10 w-10 text-cyan-300" />
          ) : (
            <Mic2 className="h-10 w-10 text-cyan-300" />
          )}
          <div className="space-y-2">
            <p className="text-lg font-semibold text-white">
              {messages.room.playbackUnavailableTitle}
            </p>
            <p className="max-w-2xl text-sm leading-6 text-slate-300">
              {getPlaybackIssueDescription(messages, issue, isTvMode)}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-4 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
            >
              {messages.common.retry}
            </button>
            <a
              href={watchUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
            >
              {messages.room.watchOnYouTube}
            </a>
            {canSkip && onSkip ? (
              <button
                type="button"
                onClick={onSkip}
                disabled={actionPending}
                className="rounded-full border border-amber-300/20 bg-amber-400/10 px-4 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {messages.host.skipCurrentSong}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <YouTube
          key={`${item.id}:${playerNonce}`}
          videoId={item.song.youtubeVideoId}
          title={item.song.title}
          opts={playerOptions}
          iframeClassName="aspect-video w-full"
          onReady={handleReady}
          onStateChange={handleStateChange}
          onError={handleError}
          onEnd={onPlaybackEnded}
        />
      )}
    </div>
  );
}

function QueueCard({
  item,
  locale,
  hostControls,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  item: QueueItemView;
  locale: AppLocale;
  hostControls: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex gap-3 rounded-2xl border border-white/8 bg-white/5 p-3">
      <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-2xl border border-white/8 bg-slate-900">
        <Image
          src={item.song.thumbnailUrl}
          alt={item.song.title}
          fill
          sizes="112px"
          className="object-cover"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-semibold text-white">
              {item.song.title}
            </p>
            <p className="mt-1 text-xs text-slate-400">{item.song.channelTitle}</p>
          </div>
          <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-xs font-semibold text-cyan-200">
            #{item.position}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
          <span className="rounded-full bg-white/6 px-2.5 py-1">
            <strong>{item.primarySinger.displayName}</strong>
            {item.secondarySinger ? ` + ${item.secondarySinger.displayName}` : ""}
          </span>
          <span className="rounded-full bg-white/6 px-2.5 py-1">
            {formatTime(item.addedAt, locale)}
          </span>
        </div>

        {hostControls ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Move song up"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Move song down"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="rounded-full border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/15"
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FavoriteSongRow({
  song,
  onAdd,
  onToggleFavorite,
}: {
  song: SongView;
  onAdd: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/5 p-3">
      <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-2xl border border-white/8 bg-slate-900">
        <Image src={song.thumbnailUrl} alt={song.title} fill sizes="80px" className="object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-semibold text-white">{song.title}</p>
        <p className="mt-1 text-xs text-slate-400">{song.channelTitle}</p>
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onAdd}
          className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onToggleFavorite}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
        >
          <Heart className="mx-auto h-4 w-4 fill-current" />
        </button>
      </div>
    </div>
  );
}

function SearchResultCard({
  result,
  isFavorite,
  disabled,
  onAdd,
  onFavorite,
}: {
  result: SearchResult;
  isFavorite: boolean;
  disabled: boolean;
  onAdd: () => void;
  onFavorite: () => void;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 p-3">
      <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/8 bg-slate-900">
        <Image
          src={result.thumbnailUrl}
          alt={result.title}
          fill
          sizes="(max-width: 768px) 100vw, 30vw"
          className="object-cover"
        />
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <p className="line-clamp-2 text-sm font-semibold text-white">{result.title}</p>
          <p className="mt-1 text-xs text-slate-400">{result.channelTitle}</p>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
            {result.description || result.languageHint}
          </p>
        </div>
        <button
          type="button"
          onClick={onFavorite}
          className={cn(
            "rounded-full border p-2 transition",
            isFavorite
              ? "border-rose-300/35 bg-rose-400/15 text-rose-100"
              : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
          )}
          aria-label={isFavorite ? "Remove favorite" : "Save favorite"}
        >
          <Heart className={cn("h-4 w-4", isFavorite ? "fill-current" : "")} />
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
          Score {result.score}
        </span>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-45"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function RoomClient({
  code,
  locale,
  mode,
}: {
  code: string;
  locale: AppLocale;
  mode: RoomMode;
}) {
  const { messages } = useI18n();
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [joinName, setJoinName] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );
  const [selectedSingerId, setSelectedSingerId] = useState("");
  const [selectedDuetId, setSelectedDuetId] = useState("");
  const [guestSection, setGuestSection] = useState<GuestSection>("search");

  const guestUrl = useMemo(
    () => (origin ? `${origin}${buildLocalePath(locale, `/room/${code}`)}` : ""),
    [code, locale, origin],
  );
  const hostUrl = useMemo(
    () => (origin ? `${origin}${buildLocalePath(locale, `/room/${code}/host`)}` : ""),
    [code, locale, origin],
  );
  const tvUrl = useMemo(
    () => (origin ? `${origin}${buildLocalePath(locale, `/room/${code}/tv`)}` : ""),
    [code, locale, origin],
  );

  const favoriteVideoIds = useMemo(
    () => new Set(roomState?.favorites.map((song) => song.youtubeVideoId) ?? []),
    [roomState?.favorites],
  );

  const canManageQueue = Boolean(roomState?.viewer.isHost);
  const canAddSongs = Boolean(roomState?.viewer.isJoined);
  const isCompactGuestView = mode === "guest";

  function getGuestSectionClass(section: GuestSection) {
    if (!isCompactGuestView) {
      return "";
    }

    return guestSection === section ? "block xl:block" : "hidden xl:block";
  }

  const applyRoomState = useCallback((payload: RoomState) => {
    setRoomState(payload);
    setJoinName((current) => current || payload.viewer.displayName || "");
    setSelectedSingerId((current) => {
      const availableIds = payload.participants.map((participant) => participant.id);

      if (current && availableIds.includes(current)) {
        return current;
      }

      return payload.viewer.profileId ?? availableIds[0] ?? "";
    });
    setSelectedDuetId((current) => {
      const availableIds = payload.participants.map((participant) => participant.id);
      return current && availableIds.includes(current) ? current : "";
    });
  }, []);

  const refreshState = useCallback(
    async (showLoading = false) => {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const response = await fetch(`/api/rooms/${code}/state`, {
          cache: "no-store",
        });

        const payload = await readJson<RoomState>(response);
        applyRoomState(payload);
        setError(null);
      } catch (caughtError) {
        setError(
          caughtError instanceof Error ? caughtError.message : messages.errors.generic,
        );
      } finally {
        setLoading(false);
      }
    },
    [applyRoomState, code, messages.errors.generic],
  );

  const performAction = useCallback(
    async (action: RoomActionInput, quiet = false) => {
      if (!quiet) {
        setActionPending(true);
      }

      try {
        const response = await fetch(`/api/rooms/${code}/action`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(action),
        });

        const payload = await readJson<RoomState>(response);
        applyRoomState(payload);
        setActionError(null);
      } catch (caughtError) {
        const message =
          caughtError instanceof Error ? caughtError.message : messages.errors.generic;

        if (!quiet) {
          setActionError(message);
        }
      } finally {
        if (!quiet) {
          setActionPending(false);
        }
      }
    },
    [applyRoomState, code, messages.errors.generic],
  );

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void refreshState(true);
    }, 0);

    return () => {
      window.clearTimeout(initialLoad);
    };
  }, [refreshState]);

  useEffect(() => {
    const eventSource = new EventSource(`/api/rooms/${code}/events`);

    eventSource.onmessage = (event) => {
      const payload = parseMaybeJson<{ reason?: string }>(event.data, {});

      if (payload.reason === "deleted") {
        setError(null);
        setRoomState(null);
        eventSource.close();
        return;
      }

      void refreshState();
    };

    return () => {
      eventSource.close();
    };
  }, [code, refreshState]);

  useEffect(() => {
    if (!roomState?.viewer.isJoined || mode === "tv") {
      return;
    }

    const heartbeat = window.setInterval(() => {
      void performAction(
        {
          type: "heartbeat",
        },
        true,
      );
    }, 45_000);

    return () => {
      window.clearInterval(heartbeat);
    };
  }, [mode, performAction, roomState?.viewer.isJoined]);

  useEffect(() => {
    if (mode === "tv" || !roomState) {
      return;
    }

    const trimmed = searchQuery.trim();

    if (!trimmed) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);

      try {
        const params = new URLSearchParams({
          q: trimmed,
          locale,
        });

        const response = await fetch(`/api/youtube/search?${params.toString()}`, {
          signal: controller.signal,
          cache: "no-store",
        });

        const payload = await readJson<{ results: SearchResult[] }>(response);
        setSearchResults(payload.results);
      } catch (caughtError) {
        if (controller.signal.aborted) {
          return;
        }

        setSearchError(
          caughtError instanceof Error ? caughtError.message : messages.errors.generic,
        );
      } finally {
        if (!controller.signal.aborted) {
          setSearchLoading(false);
        }
      }
    }, 450);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [locale, messages.errors.generic, mode, roomState, searchQuery]);

  async function handleJoin() {
    setActionPending(true);
    setActionError(null);

    try {
      const response = await fetch("/api/rooms/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          displayName: joinName,
          locale,
        }),
      });

      await readJson<{ redirectTo: string }>(response);
      await refreshState();
    } catch (caughtError) {
      setActionError(
        caughtError instanceof Error ? caughtError.message : messages.errors.generic,
      );
    } finally {
      setActionPending(false);
    }
  }

  async function copyValue(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedLabel(label);
      window.setTimeout(() => setCopiedLabel(null), 1600);
    } catch {
      setActionError(messages.room.copyError);
    }
  }

  async function addSong(song: SongView | SearchResult) {
    if (!selectedSingerId) {
      return;
    }

    await performAction({
      type: "add-queue-item",
      song: {
        youtubeVideoId: song.youtubeVideoId,
        title: song.title,
        channelTitle: song.channelTitle,
        thumbnailUrl: song.thumbnailUrl,
        durationLabel: song.durationLabel ?? undefined,
        languageHint: song.languageHint ?? undefined,
      },
      primarySingerId: selectedSingerId,
      secondarySingerId: selectedDuetId || undefined,
    });
  }

  async function toggleFavorite(song: SongView | SearchResult) {
    await performAction({
      type: "toggle-favorite",
      song: {
        youtubeVideoId: song.youtubeVideoId,
        title: song.title,
        channelTitle: song.channelTitle,
        thumbnailUrl: song.thumbnailUrl,
        durationLabel: song.durationLabel ?? undefined,
        languageHint: song.languageHint ?? undefined,
      },
    });
  }

  async function moveQueueItem(item: QueueItemView, direction: -1 | 1) {
    if (!roomState) {
      return;
    }

    const orderedIds = [...roomState.queue.map((queued) => queued.id)];
    const index = orderedIds.indexOf(item.id);
    const swapIndex = index + direction;

    if (index === -1 || swapIndex < 0 || swapIndex >= orderedIds.length) {
      return;
    }

    [orderedIds[index], orderedIds[swapIndex]] = [orderedIds[swapIndex], orderedIds[index]];

    await performAction({
      type: "reorder-queue",
      queueItemIds: orderedIds,
    });
  }

  const baseButton =
    "rounded-full border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45";

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-4 py-10 text-sm text-slate-200">
        {messages.common.loading}
      </main>
    );
  }

  if (!roomState) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-4 py-10">
        <Panel className="w-full text-center">
          <p className="text-lg font-semibold text-white">{messages.errors.roomNotFound}</p>
          <Link
            href={buildLocalePath(locale)}
            className="mt-4 inline-flex rounded-full border border-cyan-300/25 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100"
          >
            Back home
          </Link>
        </Panel>
      </main>
    );
  }

  const currentSong = roomState.current;
  const noCurrentSong = !currentSong;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-slate-950/30 backdrop-blur">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/85">
              {messages.appName}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-white sm:text-3xl">
                {roomState.room.name}
              </h1>
              <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold tracking-[0.24em] text-slate-200">
                {roomState.room.code}
              </span>
              {roomState.viewer.isHost ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-100">
                  <Crown className="h-3.5 w-3.5" />
                  {messages.common.host}
                </span>
              ) : null}
            </div>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
              {mode === "tv"
                ? messages.tv.description
                : messages.room.everyone}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <LocaleSwitcher locale={locale} />
            {mode !== "guest" ? (
              <Link
                href={buildLocalePath(locale, `/room/${code}`)}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
              >
                {messages.room.guestQueue}
              </Link>
            ) : null}
            {mode !== "host" ? (
              <Link
                href={buildLocalePath(locale, `/room/${code}/host`)}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
              >
                {messages.room.hostConsole}
              </Link>
            ) : null}
            {mode !== "tv" ? (
              <Link
                href={buildLocalePath(locale, `/room/${code}/tv`)}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
              >
                {messages.room.tvMode}
              </Link>
            ) : null}
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        {actionError ? (
          <div className="rounded-2xl border border-amber-300/35 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            {actionError}
          </div>
        ) : null}
      </header>

      {mode !== "tv" && !roomState.viewer.isJoined ? (
        <Panel className="border-cyan-400/20 bg-cyan-400/8">
          <SectionTitle
            eyebrow={messages.room.joinPromptTitle}
            title={messages.room.joinPromptDescription}
          />
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={joinName}
              onChange={(event) => setJoinName(event.target.value)}
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/60"
              placeholder={messages.home.displayName}
            />
            <button
              type="button"
              onClick={() => void handleJoin()}
              disabled={actionPending || joinName.trim().length < 2}
              className="rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-400 to-fuchsia-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-65"
            >
              {actionPending ? messages.common.loading : messages.common.join}
            </button>
          </div>
        </Panel>
      ) : null}

      {isCompactGuestView ? (
        <div className="xl:hidden">
          <div className="grid grid-cols-4 gap-2 rounded-3xl border border-white/10 bg-white/5 p-2 backdrop-blur">
            {[
              { id: "search", label: messages.common.search },
              { id: "queue", label: messages.common.queue },
              { id: "room", label: messages.common.room },
              { id: "history", label: messages.common.history },
            ].map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setGuestSection(section.id as GuestSection)}
                className={cn(
                  "rounded-2xl px-3 py-3 text-xs font-semibold transition",
                  guestSection === section.id
                    ? "bg-cyan-400/15 text-cyan-100 shadow-lg shadow-cyan-950/30"
                    : "bg-transparent text-slate-300 hover:bg-white/8",
                )}
              >
                {section.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "tv" ? (
        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <Panel className="overflow-hidden">
            <SectionTitle title={messages.common.currentSong} description={messages.tv.description} />
            <div className="mt-4">
              {currentSong ? (
                <div className="space-y-4">
                  <EmbeddedCurrentSongPlayer
                    key={currentSong.id}
                    item={currentSong}
                    origin={origin}
                    messages={messages}
                    isTvMode
                    canSkip={false}
                    actionPending={false}
                  />
                  <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                    <p className="text-xl font-semibold text-white">
                      {currentSong.song.title}
                    </p>
                    <p className="mt-2 text-sm text-slate-300">
                      {currentSong.primarySinger.displayName}
                      {currentSong.secondarySinger
                        ? ` + ${currentSong.secondarySinger.displayName}`
                        : ""}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex aspect-video flex-col items-center justify-center rounded-3xl border border-dashed border-white/12 bg-black/20 text-center">
                  <Tv2 className="h-10 w-10 text-cyan-300" />
                  <p className="mt-4 text-lg font-semibold text-white">
                    {messages.tv.standby}
                  </p>
                  <p className="mt-2 max-w-lg text-sm leading-6 text-slate-300">
                    {messages.tv.standbyHint}
                  </p>
                </div>
              )}
            </div>
          </Panel>

          <Panel>
            <SectionTitle title={messages.common.upNext} />
            <div className="mt-4 space-y-3">
              {roomState.queue.length === 0 ? (
                <p className="text-sm text-slate-400">{messages.room.noQueue}</p>
              ) : (
                roomState.queue.map((item) => (
                  <QueueCard
                    key={item.id}
                    item={item}
                    locale={locale}
                    hostControls={false}
                    canMoveUp={false}
                    canMoveDown={false}
                    onMoveUp={() => undefined}
                    onMoveDown={() => undefined}
                    onRemove={() => undefined}
                  />
                ))
              )}
            </div>
          </Panel>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <Panel>
              <SectionTitle
                eyebrow={messages.common.currentSong}
                title={currentSong ? currentSong.song.title : messages.room.noCurrentSong}
                description={
                  currentSong
                    ? `${currentSong.primarySinger.displayName}${currentSong.secondarySinger ? ` + ${currentSong.secondarySinger.displayName}` : ""}`
                    : messages.room.startHint
                }
              />

              <div className="mt-4 space-y-4">
                {mode === "host" ? (
                  currentSong ? (
                    <EmbeddedCurrentSongPlayer
                      key={currentSong.id}
                      item={currentSong}
                      origin={origin}
                      messages={messages}
                      isTvMode={false}
                      canSkip={roomState.viewer.isHost}
                      actionPending={actionPending}
                      onSkip={() =>
                        void performAction({
                          type: "advance-playback",
                          outcome: "skipped",
                        })
                      }
                      onPlaybackEnded={() =>
                        roomState.viewer.isHost
                          ? void performAction({
                              type: "advance-playback",
                              outcome: "played",
                            })
                          : undefined
                      }
                    />
                  ) : (
                    <div className="flex aspect-video flex-col items-center justify-center rounded-3xl border border-dashed border-white/12 bg-black/20 text-center">
                      <Mic2 className="h-10 w-10 text-cyan-300" />
                      <p className="mt-4 text-lg font-semibold text-white">
                        {messages.room.noCurrentSong}
                      </p>
                      <p className="mt-2 max-w-lg text-sm leading-6 text-slate-300">
                        {messages.room.startPartyGesture}
                      </p>
                    </div>
                  )
                ) : null}

                {currentSong ? (
                  <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
                    <div className="flex gap-3">
                      <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-2xl border border-white/8 bg-slate-900">
                        <Image
                          src={currentSong.song.thumbnailUrl}
                          alt={currentSong.song.title}
                          fill
                          sizes="112px"
                          className="object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-lg font-semibold text-white">
                          {currentSong.song.title}
                        </p>
                        <p className="mt-2 text-sm text-slate-300">
                          {currentSong.primarySinger.displayName}
                          {currentSong.secondarySinger
                            ? ` + ${currentSong.secondarySinger.displayName}`
                            : ""}
                        </p>
                        <p className="mt-2 text-xs text-slate-400">
                          {currentSong.song.channelTitle}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {roomState.viewer.isHost ? (
                  <div className="flex flex-wrap gap-2">
                    {noCurrentSong ? (
                      <button
                        type="button"
                        onClick={() => void performAction({ type: "start-playback" })}
                        disabled={actionPending || roomState.queue.length === 0}
                        className={`${baseButton} border-cyan-300/25 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15`}
                      >
                        <span className="inline-flex items-center gap-2">
                          <Play className="h-4 w-4" />
                          {messages.host.startFirstSong}
                        </span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void performAction({
                              type: "advance-playback",
                              outcome: "played",
                            })
                          }
                          disabled={actionPending}
                          className={`${baseButton} border-emerald-300/25 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15`}
                        >
                          <span className="inline-flex items-center gap-2">
                            <SkipForward className="h-4 w-4" />
                            {messages.host.playNextSong}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void performAction({
                              type: "advance-playback",
                              outcome: "skipped",
                            })
                          }
                          disabled={actionPending}
                          className={`${baseButton} border-rose-300/25 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15`}
                        >
                          <span className="inline-flex items-center gap-2">
                            <SkipForward className="h-4 w-4" />
                            {messages.host.skipCurrentSong}
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel className={getGuestSectionClass("queue")}>
              <SectionTitle
                eyebrow={messages.common.queue}
                title={messages.common.upNext}
                description={messages.host.reorderHelp}
              />
              <div className="mt-4 space-y-3">
                {roomState.queue.length === 0 ? (
                  <p className="text-sm text-slate-400">{messages.room.noQueue}</p>
                ) : (
                  roomState.queue.map((item, index) => (
                    <QueueCard
                      key={item.id}
                      item={item}
                      locale={locale}
                      hostControls={canManageQueue}
                      canMoveUp={index > 0}
                      canMoveDown={index < roomState.queue.length - 1}
                      onMoveUp={() => void moveQueueItem(item, -1)}
                      onMoveDown={() => void moveQueueItem(item, 1)}
                      onRemove={() =>
                        void performAction({
                          type: "remove-queue-item",
                          queueItemId: item.id,
                        })
                      }
                    />
                  ))
                )}
              </div>
            </Panel>

            <Panel className={getGuestSectionClass("search")}>
              <SectionTitle
                eyebrow={messages.search.title}
                title={messages.search.subtitle}
              />

              <div className="mt-4 space-y-4">
                <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px]">
                  <input
                    value={searchQuery}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setSearchQuery(nextValue);

                      if (!nextValue.trim()) {
                        setSearchResults([]);
                        setSearchError(null);
                      }
                    }}
                    className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/60"
                    placeholder={messages.search.placeholder}
                  />
                  <select
                    value={selectedSingerId}
                    onChange={(event) => setSelectedSingerId(event.target.value)}
                    className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none"
                  >
                    {roomState.participants.map((participant) => (
                      <option
                        key={participant.id}
                        value={participant.id}
                        className="bg-slate-950 text-slate-100"
                      >
                        {messages.room.addFor}: {participant.displayName}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedDuetId}
                    onChange={(event) => setSelectedDuetId(event.target.value)}
                    className="rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none"
                  >
                    <option value="" className="bg-slate-950 text-slate-100">
                      {messages.room.duetOptional}
                    </option>
                    {roomState.participants
                      .filter((participant) => participant.id !== selectedSingerId)
                      .map((participant) => (
                        <option
                          key={participant.id}
                          value={participant.id}
                          className="bg-slate-950 text-slate-100"
                        >
                          {messages.room.duetWith}: {participant.displayName}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="flex flex-wrap gap-2">
                  {roomState.themePresets.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => setSearchQuery(theme.searchHint)}
                      className={cn(
                        "rounded-full border px-3 py-2 text-xs font-semibold transition",
                        roomState.room.themeId === theme.id
                          ? "border-fuchsia-300/25 bg-fuchsia-400/10 text-fuchsia-100"
                          : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10",
                      )}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Sparkles className="h-3.5 w-3.5" />
                        {theme.name}
                      </span>
                    </button>
                  ))}
                </div>

                {searchError ? (
                  <div className="rounded-2xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                    {searchError}
                  </div>
                ) : null}

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {searchLoading ? (
                    <p className="text-sm text-slate-300">{messages.common.loading}</p>
                  ) : searchResults.length === 0 ? (
                    <p className="text-sm text-slate-400">
                      {searchQuery ? messages.search.noResults : messages.search.empty}
                    </p>
                  ) : (
                    searchResults.map((result) => (
                      <SearchResultCard
                        key={result.youtubeVideoId}
                        result={result}
                        isFavorite={favoriteVideoIds.has(result.youtubeVideoId)}
                        disabled={!canAddSongs || actionPending}
                        onAdd={() => void addSong(result)}
                        onFavorite={() => void toggleFavorite(result)}
                      />
                    ))
                  )}
                </div>
              </div>
            </Panel>
          </div>

          <div className="space-y-6">
            <Panel className={getGuestSectionClass("room")}>
              <SectionTitle
                eyebrow={messages.room.shareRoom}
                title={messages.room.shareToTv}
                description={messages.room.qrHint}
              />
              <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr]">
                <div className="mx-auto rounded-3xl border border-white/10 bg-white p-3">
                  <QRCodeSVG value={guestUrl || `https://example.invalid/${code}`} size={144} />
                </div>
                <div className="space-y-3">
                  {[
                    {
                      label: messages.room.guestLink,
                      value: guestUrl,
                    },
                    {
                      label: messages.room.hostLink,
                      value: hostUrl,
                    },
                    {
                      label: messages.room.tvLink,
                      value: tvUrl,
                    },
                  ].map((entry) => (
                    <div
                      key={entry.label}
                      className="rounded-2xl border border-white/8 bg-white/5 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                            {entry.label}
                          </p>
                          <p className="mt-2 truncate text-sm text-white">{entry.value}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void copyValue(entry.label, entry.value)}
                          className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-200 transition hover:bg-white/10"
                          aria-label={messages.common.copyLink}
                        >
                          <Link2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {copiedLabel ? (
                    <p className="text-xs text-cyan-200">
                      {copiedLabel}: {messages.common.copied}
                    </p>
                  ) : null}
                </div>
              </div>
            </Panel>

            <Panel className={getGuestSectionClass("search")}>
              <SectionTitle
                eyebrow={messages.common.favorites}
                title={messages.common.favorites}
                description={messages.room.noFavorites}
              />
              <div className="mt-4 space-y-3">
                {roomState.favorites.length === 0 ? (
                  <p className="text-sm text-slate-400">{messages.room.noFavorites}</p>
                ) : (
                  roomState.favorites.map((song) => (
                    <FavoriteSongRow
                      key={song.id}
                      song={song}
                      onAdd={() => void addSong(song)}
                      onToggleFavorite={() => void toggleFavorite(song)}
                    />
                  ))
                )}
              </div>
            </Panel>

            <Panel className={getGuestSectionClass("room")}>
              <SectionTitle
                eyebrow={messages.room.participants}
                title={messages.room.participants}
                description={messages.room.leaveClosed}
              />
              <div className="mt-4 space-y-3">
                {roomState.participants.map((participant) => (
                  <div
                    key={participant.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/5 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-white">
                          {participant.displayName}
                        </p>
                        {participant.isHost ? (
                          <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2 py-1 text-[11px] font-semibold text-amber-100">
                            {messages.common.host}
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            "rounded-full px-2 py-1 text-[11px] font-semibold",
                            participant.isPresent
                              ? "bg-emerald-400/10 text-emerald-100"
                              : "bg-white/6 text-slate-300",
                          )}
                        >
                          {participant.isPresent
                            ? messages.common.online
                            : messages.common.offline}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">
                        {formatRelativeShort(participant.lastSeenAt, locale)}
                      </p>
                    </div>
                    {roomState.viewer.isHost && !participant.isHost ? (
                      <button
                        type="button"
                        onClick={() =>
                          void performAction({
                            type: "make-host",
                            profileId: participant.id,
                          })
                        }
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
                      >
                        {messages.room.makeHost}
                      </button>
                    ) : null}
                  </div>
                ))}

                {!roomState.viewer.isHost && roomState.viewer.canClaimHost ? (
                  <button
                    type="button"
                    onClick={() => void performAction({ type: "claim-host" })}
                    className="w-full rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/15"
                  >
                    {messages.room.claimHost}
                  </button>
                ) : null}
              </div>
            </Panel>

            {roomState.viewer.isHost ? (
              <Panel>
                <SectionTitle
                  eyebrow={messages.room.queueManagement}
                  title={messages.room.queueManagement}
                  description={messages.host.hostOnly}
                />
                <div className="mt-4 grid gap-3 sm:grid-cols-1">
                  <button
                    type="button"
                    onClick={() =>
                      void performAction({
                        type: "rebalance-queue",
                      })
                    }
                    className="rounded-2xl border border-fuchsia-300/20 bg-fuchsia-400/10 px-4 py-3 text-left text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-400/15"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Shuffle className="h-4 w-4" />
                      {messages.host.fairTurns}
                    </span>
                  </button>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-400">
                  {messages.host.fairTurnsHelp}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {roomState.themePresets.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() =>
                        void performAction({
                          type: "update-settings",
                          themeId:
                            roomState.room.themeId === theme.id ? null : theme.id,
                        })
                      }
                      className={cn(
                        "rounded-full border px-3 py-2 text-xs font-semibold transition",
                        roomState.room.themeId === theme.id
                          ? "border-cyan-300/25 bg-cyan-400/10 text-cyan-100"
                          : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10",
                      )}
                    >
                      {theme.name}
                    </button>
                  ))}
                </div>
              </Panel>
            ) : null}

            <Panel className={getGuestSectionClass("room")}>
              <SectionTitle
                eyebrow={messages.room.reactionPrompt}
                title={messages.room.reactionPrompt}
                description={messages.host.crowdBoard}
              />
              <div className="mt-4 flex flex-wrap gap-2">
                {CROWD_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() =>
                      void performAction({
                        type: "add-reaction",
                        emoji,
                      })
                    }
                    disabled={!roomState.viewer.isJoined}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xl transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {roomState.recentReactions.length === 0 ? (
                  <p className="text-sm text-slate-400">{messages.search.empty}</p>
                ) : (
                  roomState.recentReactions.map((reaction) => (
                    <div
                      key={reaction.id}
                      className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/5 px-4 py-3 text-sm"
                    >
                      <span className="flex items-center gap-3 text-white">
                        <span className="text-xl">{reaction.emoji}</span>
                        {reaction.byDisplayName}
                      </span>
                      <span className="text-xs text-slate-400">
                        {formatTime(reaction.createdAt, locale)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Panel>

            <Panel className={getGuestSectionClass("history")}>
              <SectionTitle
                eyebrow={messages.common.history}
                title={messages.common.history}
                description={messages.host.encoreVotes}
              />
              <div className="mt-4 space-y-3">
                {roomState.history.length === 0 ? (
                  <p className="text-sm text-slate-400">{messages.room.noHistory}</p>
                ) : (
                  roomState.history.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-white/8 bg-white/5 p-3"
                    >
                      <div className="flex gap-3">
                        <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-2xl border border-white/8 bg-slate-900">
                          <Image
                            src={item.song.thumbnailUrl}
                            alt={item.song.title}
                            fill
                            sizes="112px"
                            className="object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-semibold text-white">
                            {item.song.title}
                          </p>
                          <p className="mt-1 text-xs text-slate-400">
                            {item.primarySinger.displayName}
                            {item.secondarySinger
                              ? ` + ${item.secondarySinger.displayName}`
                              : ""}
                          </p>
                          <p className="mt-2 text-xs text-slate-500">
                            {formatRelativeShort(item.completedAt, locale)}
                          </p>
                          <div className="mt-3 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                void performAction({
                                  type: "toggle-encore-vote",
                                  historyId: item.id,
                                })
                              }
                              disabled={!roomState.viewer.isJoined}
                              className={cn(
                                "rounded-full border px-3 py-2 text-xs font-semibold transition",
                                item.viewerVoted
                                  ? "border-rose-300/25 bg-rose-400/10 text-rose-100"
                                  : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10",
                              )}
                            >
                              <span className="inline-flex items-center gap-2">
                                <Heart className={cn("h-4 w-4", item.viewerVoted ? "fill-current" : "")} />
                                Encore {item.encoreVotes}
                              </span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void refreshState(true)}
          className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
        >
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="h-4 w-4" />
            {messages.common.refresh}
          </span>
        </button>
      </div>
    </main>
  );
}

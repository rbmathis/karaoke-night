"use client";

import {
  ArrowDown,
  ArrowUp,
  Crown,
  Heart,
  Link2,
  Mic2,
  PanelRightClose,
  PanelRightOpen,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Shuffle,
  SkipForward,
  Sparkles,
  Tv2,
  X,
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
  ReactionView,
  RoomActionInput,
  RoomState,
  SearchResult,
  SongView,
} from "@/lib/room-types";
import type { AppLocale } from "@/lib/locale";
import { buildLocalePath, cn, formatRelativeShort, formatTime, parseMaybeJson } from "@/lib/utils";

type RoomMode = "guest" | "host" | "tv";
type WorkspaceTab = "add" | "queue" | "favorites" | "room" | "history";
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

function ReactionOverlay({ reactions }: { reactions: ReactionView[] }) {
  const [floaters, setFloaters] = useState<
    Array<{ key: string; emoji: string; left: number; duration: number; drift: number }>
  >([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const isFirstRunRef = useRef(true);

  useEffect(() => {
    const currentIds = new Set(reactions.map((reaction) => reaction.id));

    // Skip the first render so existing reactions from history don't all
    // burst on screen at once when the player first mounts.
    if (isFirstRunRef.current) {
      isFirstRunRef.current = false;
      seenIdsRef.current = currentIds;
      return;
    }

    const freshReactions = reactions.filter((reaction) => !seenIdsRef.current.has(reaction.id));
    seenIdsRef.current = currentIds;

    if (freshReactions.length === 0) {
      return;
    }

    setFloaters((current) => [
      ...current,
      ...freshReactions.map((reaction) => ({
        key: `${reaction.id}:${Math.random().toString(36).slice(2)}`,
        emoji: reaction.emoji,
        left: 8 + Math.random() * 84,
        duration: 2.6 + Math.random() * 1.2,
        drift: Math.random() * 48 - 24,
      })),
    ]);
  }, [reactions]);

  const removeFloater = useCallback((key: string) => {
    setFloaters((current) => current.filter((floater) => floater.key !== key));
  }, []);

  if (floaters.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {floaters.map((floater) => (
        <span
          key={floater.key}
          onAnimationEnd={() => removeFloater(floater.key)}
          className="reaction-floater absolute bottom-2 text-3xl drop-shadow-lg"
          style={
            {
              left: `${floater.left}%`,
              animationDuration: `${floater.duration}s`,
              "--reaction-drift": `${floater.drift}px`,
            } as React.CSSProperties
          }
        >
          {floater.emoji}
        </span>
      ))}
    </div>
  );
}

function EmbeddedCurrentSongPlayer({
  item,
  origin,
  messages,
  isTvMode,
  canSkip,
  actionPending,
  reactions,
  onSkip,
  onSwapVersion,
  onPlaybackEnded,
  onPlaybackError,
  onPlaybackSuccess,
}: {
  item: QueueItemView;
  origin: string;
  messages: Messages;
  isTvMode: boolean;
  canSkip: boolean;
  actionPending: boolean;
  reactions?: ReactionView[];
  onSkip?: () => void;
  onSwapVersion?: () => void;
  onPlaybackEnded?: () => void;
  onPlaybackError?: (youtubeVideoId: string, errorCode: number) => void;
  onPlaybackSuccess?: (youtubeVideoId: string) => void;
}) {
  const [issue, setIssue] = useState<PlaybackIssue | null>(null);
  const [playerNonce, setPlayerNonce] = useState(0);
  const watchdogRef = useRef<number | null>(null);
  const hasStartedRef = useRef(false);
  const reportedSuccessRef = useRef(false);

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

        if (!reportedSuccessRef.current) {
          reportedSuccessRef.current = true;
          onPlaybackSuccess?.(item.song.youtubeVideoId);
        }
      }
    },
    [clearWatchdog, item.song.youtubeVideoId, onPlaybackSuccess],
  );

  const handleError = useCallback(
    (event: YouTubeEvent<number>) => {
      clearWatchdog();
      setIssue({
        kind: "error",
        code: event.data,
      });
      onPlaybackError?.(item.song.youtubeVideoId, event.data);
    },
    [clearWatchdog, item.song.youtubeVideoId, onPlaybackError],
  );

  const handleRetry = useCallback(() => {
    clearWatchdog();
    hasStartedRef.current = false;
    reportedSuccessRef.current = false;
    setIssue(null);
    setPlayerNonce((current) => current + 1);
  }, [clearWatchdog]);

  const playerOptions = useMemo(
    () => ({
      width: "100%",
      height: "100%",
      host: "https://www.youtube.com",
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
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black">
      {issue?.kind === "error" ? (
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
            {onSwapVersion ? (
              <button
                type="button"
                onClick={onSwapVersion}
                disabled={actionPending}
                className="rounded-full border border-emerald-300/30 bg-emerald-400/15 px-4 py-2 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {messages.room.tryAnotherVersion}
              </button>
            ) : null}
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
        <>
          <YouTube
            key={`${item.id}:${item.song.youtubeVideoId}:${playerNonce}`}
            videoId={item.song.youtubeVideoId}
            title={item.song.title}
            opts={playerOptions}
            iframeClassName="aspect-video w-full"
            onReady={handleReady}
            onStateChange={handleStateChange}
            onError={handleError}
            onEnd={onPlaybackEnded}
          />
          <ReactionOverlay reactions={reactions ?? []} />
          {issue?.kind === "stalled" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-slate-950/90 px-4 py-3 text-xs text-slate-200">
              <span>{messages.room.playbackStalledBanner}</span>
              <div className="flex flex-wrap items-center gap-2">
                {onSwapVersion ? (
                  <button
                    type="button"
                    onClick={onSwapVersion}
                    disabled={actionPending}
                    className="rounded-full border border-emerald-300/30 bg-emerald-400/15 px-3 py-1.5 font-semibold text-emerald-100 transition hover:bg-emerald-400/25 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {messages.room.tryAnotherVersion}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={handleRetry}
                  className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1.5 font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
                >
                  {messages.common.retry}
                </button>
                <a
                  href={watchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  {messages.room.watchOnYouTube}
                </a>
              </div>
            </div>
          ) : null}
        </>
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
  messages,
  onAdd,
  onFavorite,
}: {
  result: SearchResult;
  isFavorite: boolean;
  disabled: boolean;
  messages: Messages;
  onAdd: () => void;
  onFavorite: () => void;
}) {
  // Older cache entries predate the embeddable flag and were already
  // filtered to embeddable-only, so treat a missing value as embeddable.
  const isEmbeddable = result.embeddable !== false;

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
      {!isEmbeddable ? (
        <p className="mt-2 rounded-xl border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-[11px] leading-4 text-amber-100">
          {messages.search.notEmbeddableHint}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-100">
            Score {result.score}
          </span>
          {!isEmbeddable ? (
            <span className="rounded-full border border-amber-300/25 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-100">
              {messages.search.notEmbeddableBadge}
            </span>
          ) : null}
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
  const [searchNextPageToken, setSearchNextPageToken] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchLoadingMore, setSearchLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [joinName, setJoinName] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );
  const [selectedSingerId, setSelectedSingerId] = useState("");
  const [selectedDuetId, setSelectedDuetId] = useState("");
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(
    mode === "host" ? "queue" : "add",
  );
  const [showShareModal, setShowShareModal] = useState(false);
  const [showTvQueue, setShowTvQueue] = useState(true);

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

        const payload = await readJson<{
          results: SearchResult[];
          nextPageToken?: string | null;
        }>(response);
        setSearchResults(payload.results);
        setSearchNextPageToken(payload.nextPageToken ?? null);
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

  async function handleLoadMore() {
    const trimmed = searchQuery.trim();

    if (!trimmed || !searchNextPageToken || searchLoadingMore) {
      return;
    }

    setSearchLoadingMore(true);
    setSearchError(null);

    try {
      const params = new URLSearchParams({
        q: trimmed,
        locale,
        pageToken: searchNextPageToken,
      });

      const response = await fetch(`/api/youtube/search?${params.toString()}`, {
        cache: "no-store",
      });

      const payload = await readJson<{
        results: SearchResult[];
        nextPageToken?: string | null;
      }>(response);

      setSearchResults((current) => {
        const seen = new Set(current.map((item) => item.youtubeVideoId));
        const fresh = payload.results.filter((item) => !seen.has(item.youtubeVideoId));
        return [...current, ...fresh];
      });
      setSearchNextPageToken(payload.nextPageToken ?? null);
    } catch (caughtError) {
      setSearchError(
        caughtError instanceof Error ? caughtError.message : messages.errors.generic,
      );
    } finally {
      setSearchLoadingMore(false);
    }
  }

  function focusAddSong() {
    if (mode === "guest") {
      setActiveTab("add");
    }

    window.setTimeout(() => {
      searchInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      searchInputRef.current?.focus();
    }, 50);
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

  const shareModal = showShareModal ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={() => setShowShareModal(false)}
    >
      <div
        className="w-full max-w-lg rounded-3xl border border-white/12 bg-slate-900 p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">{messages.room.shareRoom}</h2>
            <p className="mt-1 text-xs text-slate-400">{messages.room.qrHint}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowShareModal(false)}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 transition hover:bg-white/10 hover:text-white"
            aria-label={messages.common.close}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <div className="shrink-0 rounded-2xl border border-white/10 bg-white p-3">
            <QRCodeSVG value={guestUrl || `https://example.invalid/${code}`} size={148} />
          </div>
          <div className="w-full min-w-0 flex-1 space-y-2.5">
            {[
              { label: messages.room.guestLink, value: guestUrl },
              { label: messages.room.hostLink, value: hostUrl },
              { label: messages.room.tvLink, value: tvUrl },
            ].map((entry) => (
              <div
                key={entry.label}
                className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/5 px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    {entry.label}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-200">{entry.value}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void copyValue(entry.label, entry.value)}
                  className="shrink-0 rounded-full border border-white/10 bg-white/5 p-2 text-slate-200 transition hover:bg-white/10"
                  aria-label={messages.common.copyLink}
                >
                  <Link2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {copiedLabel ? (
              <p className="text-xs font-medium text-cyan-200">
                {copiedLabel}: {messages.common.copied}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  ) : null;

  if (mode === "tv") {
    return (
      <main className="flex min-h-screen w-full flex-col bg-slate-950 px-3 py-3 sm:px-4">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-base font-semibold text-white sm:text-lg">
              {roomState.room.name}
            </h1>
            <span className="rounded-full border border-white/10 bg-white/8 px-2.5 py-0.5 text-xs font-semibold tracking-[0.2em] text-cyan-200">
              {roomState.room.code}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTvQueue((current) => !current)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
            >
              {showTvQueue ? (
                <PanelRightClose className="h-3.5 w-3.5" />
              ) : (
                <PanelRightOpen className="h-3.5 w-3.5" />
              )}
              {messages.common.upNext} ({roomState.queue.length})
            </button>
            <button
              type="button"
              onClick={() => setShowShareModal(true)}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
            >
              <QrCode className="h-3.5 w-3.5" />
              {messages.room.shareRoom}
            </button>
            <Link
              href={buildLocalePath(locale, `/room/${code}/host`)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
            >
              {messages.room.hostConsole}
            </Link>
          </div>
        </header>

        {error || actionError ? (
          <div className="mb-3 rounded-2xl border border-amber-300/35 bg-amber-400/10 px-4 py-2.5 text-sm text-amber-100">
            {error ?? actionError}
          </div>
        ) : null}

        <div
          className={cn(
            "grid flex-1 gap-4",
            showTvQueue ? "lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_360px]" : "grid-cols-1",
          )}
        >
          <div className="flex flex-col justify-center">
            {currentSong ? (
              <div className="space-y-3">
                <div className="relative rounded-3xl p-[1px] shadow-[0_0_60px_-15px_rgba(251,146,60,0.35)]">
                  <EmbeddedCurrentSongPlayer
                    key={`${currentSong.id}:${currentSong.song.youtubeVideoId}`}
                    item={currentSong}
                    origin={origin}
                    messages={messages}
                    isTvMode
                    canSkip={false}
                    actionPending={actionPending}
                    reactions={roomState.recentReactions}
                    onSwapVersion={() =>
                      void performAction({
                        type: "swap-current-song",
                      })
                    }
                    onPlaybackError={(youtubeVideoId, errorCode) =>
                      void performAction(
                        {
                          type: "report-playback-error",
                          youtubeVideoId,
                          errorCode,
                        },
                        true,
                      )
                    }
                    onPlaybackSuccess={(youtubeVideoId) =>
                      void performAction(
                        {
                          type: "report-playback-success",
                          youtubeVideoId,
                        },
                        true,
                      )
                    }
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300/20 bg-gradient-to-r from-amber-500/12 via-fuchsia-500/10 to-slate-900/80 px-4 py-3 backdrop-blur">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="now-singing-mic flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-amber-300/40 bg-amber-400/20 text-amber-200">
                      <Mic2 className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300">
                        {messages.common.currentSong}
                      </p>
                      <p className="truncate text-lg font-semibold text-white sm:text-xl">
                        {currentSong.primarySinger.displayName}
                        {currentSong.secondarySinger
                          ? ` + ${currentSong.secondarySinger.displayName}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <p className="max-w-xl truncate text-sm font-medium text-slate-200 sm:text-base">
                    {currentSong.song.title}
                  </p>
                </div>
              </div>
            ) : (
              <div className="relative flex aspect-video flex-col items-center justify-center overflow-hidden rounded-3xl border border-amber-200/15 bg-slate-950 px-6 text-center shadow-2xl">
                <Image
                  src="/images/tv-standby-stage.jpg"
                  alt="Family Night Karaoke Stage"
                  fill
                  priority
                  sizes="100vw"
                  className="object-cover opacity-80"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/55 to-slate-950/40" />
                <div className="relative z-10 flex max-w-lg flex-col items-center">
                  <span className="now-singing-mic flex h-14 w-14 items-center justify-center rounded-full border border-amber-300/40 bg-amber-400/20 text-amber-200">
                    <Mic2 className="h-7 w-7" />
                  </span>
                  <p className="mt-4 text-2xl font-semibold text-white drop-shadow sm:text-3xl">
                    {messages.tv.standby}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-200 sm:text-base">
                    {messages.tv.standbyHint}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowShareModal(true)}
                    className="mt-5 inline-flex items-center gap-2 rounded-full border border-amber-300/35 bg-amber-400/20 px-5 py-2.5 text-sm font-semibold text-amber-100 backdrop-blur transition hover:bg-amber-400/30"
                  >
                    <QrCode className="h-4 w-4" />
                    {messages.room.shareRoom}
                  </button>
                </div>
              </div>
            )}
          </div>

          {showTvQueue ? (
            <aside className="flex flex-col rounded-3xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300/90">
                  {messages.common.upNext}
                </h2>
                <span className="text-xs text-slate-400">{roomState.queue.length}</span>
              </div>
              <div className="mt-3 flex-1 space-y-2.5 overflow-y-auto">
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
            </aside>
          ) : null}
        </div>

        {shareModal}
      </main>
    );
  }

  const addSongPanel = (
    <Panel className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-base font-semibold text-white">
          <Plus className="h-4 w-4 text-cyan-300" />
          {messages.search.title}
        </h2>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(event) => {
            const nextValue = event.target.value;
            setSearchQuery(nextValue);

            if (!nextValue.trim()) {
              setSearchResults([]);
              setSearchNextPageToken(null);
              setSearchError(null);
            }
          }}
          className="w-full rounded-2xl border border-white/12 bg-slate-900/90 py-3.5 pl-12 pr-4 text-base text-white outline-none transition placeholder:text-slate-400 focus:border-cyan-400/70"
          placeholder={messages.search.placeholder}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <select
          value={selectedSingerId}
          onChange={(event) => setSelectedSingerId(event.target.value)}
          className="rounded-full border border-white/10 bg-slate-900/80 px-3.5 py-2 text-xs font-medium text-slate-100 outline-none"
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
          className="rounded-full border border-white/10 bg-slate-900/80 px-3.5 py-2 text-xs font-medium text-slate-100 outline-none"
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

        <div className="flex flex-wrap gap-1.5">
          {roomState.themePresets.map((theme) => (
            <button
              key={theme.id}
              type="button"
              onClick={() => setSearchQuery(theme.searchHint)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                roomState.room.themeId === theme.id
                  ? "border-fuchsia-300/30 bg-fuchsia-400/15 text-fuchsia-100"
                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
              )}
            >
              <Sparkles className="h-3 w-3" />
              {theme.name}
            </button>
          ))}
        </div>
      </div>

      {searchError ? (
        <div className="rounded-2xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          {searchError}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
              messages={messages}
              onAdd={() => void addSong(result)}
              onFavorite={() => void toggleFavorite(result)}
            />
          ))
        )}
      </div>

      {searchNextPageToken && !searchLoading ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => void handleLoadMore()}
            disabled={searchLoadingMore}
            className="rounded-full border border-cyan-300/30 bg-cyan-400/12 px-6 py-2.5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {searchLoadingMore ? messages.common.loading : "Load more songs"}
          </button>
        </div>
      ) : null}
    </Panel>
  );

  const workspaceTabs: Array<{ id: WorkspaceTab; label: string; badge?: number; accent?: boolean }> =
    mode === "host"
      ? [
          { id: "queue", label: messages.common.upNext, badge: roomState.queue.length },
          { id: "favorites", label: messages.common.favorites, badge: roomState.favorites.length },
          { id: "room", label: messages.common.room, badge: roomState.participants.length },
          { id: "history", label: messages.common.history, badge: roomState.history.length },
        ]
      : [
          { id: "add", label: messages.search.addSong, accent: true },
          { id: "queue", label: messages.common.upNext, badge: roomState.queue.length },
          { id: "favorites", label: messages.common.favorites, badge: roomState.favorites.length },
          { id: "room", label: messages.common.room, badge: roomState.participants.length },
          { id: "history", label: messages.common.history, badge: roomState.history.length },
        ];

  const workspaceContent = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/60 p-1.5 backdrop-blur">
        {workspaceTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-semibold transition sm:text-sm",
                isActive
                  ? tab.accent
                    ? "bg-gradient-to-r from-cyan-400 via-sky-400 to-fuchsia-400 text-slate-950 shadow-md"
                    : "bg-white/12 text-white shadow-sm"
                  : tab.accent
                    ? "bg-cyan-400/12 text-cyan-100 hover:bg-cyan-400/20"
                    : "text-slate-300 hover:bg-white/6 hover:text-white",
              )}
            >
              {tab.accent ? <Plus className="h-4 w-4" /> : null}
              <span>{tab.label}</span>
              {typeof tab.badge === "number" && tab.badge > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px]",
                    isActive ? "bg-white/15 text-white" : "bg-white/8 text-slate-300",
                  )}
                >
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {activeTab === "add" && mode !== "host" ? addSongPanel : null}

      {activeTab === "queue" ? (
        <Panel className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white">{messages.common.upNext}</h2>
            <div className="flex items-center gap-2">
              {roomState.viewer.isHost && roomState.queue.length > 1 ? (
                <button
                  type="button"
                  onClick={() => void performAction({ type: "rebalance-queue" })}
                  disabled={actionPending}
                  className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-300/25 bg-fuchsia-400/10 px-3 py-1.5 text-xs font-semibold text-fuchsia-100 transition hover:bg-fuchsia-400/15"
                >
                  <Shuffle className="h-3.5 w-3.5" />
                  {messages.host.fairTurns}
                </button>
              ) : null}
              <button
                type="button"
                onClick={focusAddSong}
                className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-400/20"
              >
                <Plus className="h-3.5 w-3.5" />
                {messages.search.addSong}
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {roomState.queue.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
                <p className="text-sm text-slate-300">{messages.room.noQueue}</p>
                <button
                  type="button"
                  onClick={focusAddSong}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-fuchsia-400 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:brightness-110"
                >
                  <Plus className="h-4 w-4" />
                  {messages.search.addSong}
                </button>
              </div>
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
      ) : null}

      {activeTab === "favorites" ? (
        <Panel className="space-y-4">
          <h2 className="text-base font-semibold text-white">{messages.common.favorites}</h2>
          <div className="space-y-3">
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
      ) : null}

      {activeTab === "room" ? (
        <div className="space-y-4">
          <Panel className="space-y-4">
            <h2 className="text-base font-semibold text-white">{messages.room.participants}</h2>
            <div className="space-y-2.5">
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
                        <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
                          {messages.common.host}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
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
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
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
            <Panel className="space-y-3">
              <h2 className="text-base font-semibold text-white">{messages.common.theme}</h2>
              <div className="flex flex-wrap gap-2">
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
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
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

          <Panel className="space-y-3">
            <h2 className="text-base font-semibold text-white">{messages.room.reactionPrompt}</h2>
            <div className="flex flex-wrap gap-2">
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
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xl transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {emoji}
                </button>
              ))}
            </div>
            {roomState.recentReactions.length > 0 ? (
              <div className="space-y-2 pt-1">
                {roomState.recentReactions.slice(0, 6).map((reaction) => (
                  <div
                    key={reaction.id}
                    className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/5 px-3.5 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2.5 text-white">
                      <span className="text-lg">{reaction.emoji}</span>
                      {reaction.byDisplayName}
                    </span>
                    <span className="text-xs text-slate-400">
                      {formatTime(reaction.createdAt, locale)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </Panel>
        </div>
      ) : null}

      {activeTab === "history" ? (
        <Panel className="space-y-4">
          <h2 className="text-base font-semibold text-white">{messages.common.history}</h2>
          <div className="space-y-3">
            {roomState.history.length === 0 ? (
              <p className="text-sm text-slate-400">{messages.room.noHistory}</p>
            ) : (
              roomState.history.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/5 p-3"
                >
                  <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-xl border border-white/8 bg-slate-900">
                    <Image
                      src={item.song.thumbnailUrl}
                      alt={item.song.title}
                      fill
                      sizes="96px"
                      className="object-cover"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-semibold text-white">
                      {item.song.title}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {item.primarySinger.displayName}
                      {item.secondarySinger
                        ? ` + ${item.secondarySinger.displayName}`
                        : ""}{" "}
                      · {formatRelativeShort(item.completedAt, locale)}
                    </p>
                  </div>
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
                      "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                      item.viewerVoted
                        ? "border-rose-300/25 bg-rose-400/10 text-rose-100"
                        : "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10",
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Heart className={cn("h-3.5 w-3.5", item.viewerVoted ? "fill-current" : "")} />
                      {item.encoreVotes}
                    </span>
                  </button>
                </div>
              ))
            )}
          </div>
        </Panel>
      ) : null}
    </div>
  );

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 shadow-lg shadow-slate-950/30 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-lg font-semibold text-white sm:text-xl">
            {roomState.room.name}
          </h1>
          <span className="rounded-full border border-white/10 bg-white/8 px-2.5 py-0.5 text-xs font-semibold tracking-[0.2em] text-cyan-200">
            {roomState.room.code}
          </span>
          {roomState.viewer.isHost ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-0.5 text-xs font-semibold text-amber-100">
              <Crown className="h-3.5 w-3.5" />
              {messages.common.host}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowShareModal(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
          >
            <QrCode className="h-3.5 w-3.5" />
            {messages.room.shareRoom}
          </button>
          {mode !== "guest" ? (
            <Link
              href={buildLocalePath(locale, `/room/${code}`)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
            >
              {messages.room.guestQueue}
            </Link>
          ) : null}
          {mode !== "host" ? (
            <Link
              href={buildLocalePath(locale, `/room/${code}/host`)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
            >
              {messages.room.hostConsole}
            </Link>
          ) : null}
          <Link
            href={buildLocalePath(locale, `/room/${code}/tv`)}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
          >
            {messages.room.tvMode}
          </Link>
          <LocaleSwitcher locale={locale} />
          <button
            type="button"
            onClick={() => void refreshState(true)}
            className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-200 transition hover:bg-white/10"
            aria-label={messages.common.refresh}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

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

      {!roomState.viewer.isJoined ? (
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
              className="rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-400 to-fuchsia-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-65"
            >
              {actionPending ? messages.common.loading : messages.common.join}
            </button>
          </div>
        </Panel>
      ) : null}

      {mode === "host" ? (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
            <div className="space-y-4">
            {currentSong ? (
              <EmbeddedCurrentSongPlayer
                key={`${currentSong.id}:${currentSong.song.youtubeVideoId}`}
                item={currentSong}
                origin={origin}
                messages={messages}
                isTvMode={false}
                canSkip={roomState.viewer.isHost}
                actionPending={actionPending}
                reactions={roomState.recentReactions}
                onSkip={() =>
                  void performAction({
                    type: "advance-playback",
                    outcome: "skipped",
                  })
                }
                onSwapVersion={() =>
                  void performAction({
                    type: "swap-current-song",
                  })
                }
                onPlaybackError={(youtubeVideoId, errorCode) =>
                  void performAction(
                    {
                      type: "report-playback-error",
                      youtubeVideoId,
                      errorCode,
                    },
                    true,
                  )
                }
                onPlaybackSuccess={(youtubeVideoId) =>
                  void performAction(
                    {
                      type: "report-playback-success",
                      youtubeVideoId,
                    },
                    true,
                  )
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
              <div className="flex aspect-video flex-col items-center justify-center rounded-3xl border border-dashed border-white/12 bg-black/30 px-6 text-center">
                <Mic2 className="h-10 w-10 text-cyan-300" />
                <p className="mt-4 text-lg font-semibold text-white">
                  {messages.room.noCurrentSong}
                </p>
                <p className="mt-2 max-w-md text-sm text-slate-300">
                  {messages.room.startPartyGesture}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-white">
                  {currentSong ? currentSong.song.title : messages.room.noCurrentSong}
                </p>
                <p className="mt-0.5 text-xs text-slate-300">
                  {currentSong
                    ? `${currentSong.primarySinger.displayName}${currentSong.secondarySinger ? ` + ${currentSong.secondarySinger.displayName}` : ""}`
                    : messages.room.startHint}
                </p>
              </div>

              {roomState.viewer.isHost ? (
                <div className="flex flex-wrap items-center gap-2">
                  {noCurrentSong ? (
                    <button
                      type="button"
                      onClick={() => void performAction({ type: "start-playback" })}
                      disabled={actionPending || roomState.queue.length === 0}
                      className={`${baseButton} border-cyan-300/30 bg-cyan-400/15 text-cyan-100 hover:bg-cyan-400/25`}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Play className="h-3.5 w-3.5" />
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
                        className={`${baseButton} border-emerald-300/30 bg-emerald-400/15 text-emerald-100 hover:bg-emerald-400/25`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <SkipForward className="h-3.5 w-3.5" />
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
                        className={`${baseButton} border-rose-300/25 bg-rose-400/10 text-rose-100 hover:bg-rose-400/20`}
                      >
                        {messages.common.skip}
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </div>

            {roomState.viewer.isJoined ? (
              <div className="flex flex-wrap items-center gap-2">
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
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-lg transition hover:bg-white/10"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div>{workspaceContent}</div>
          </div>

          {addSongPanel}
        </div>
      ) : (
        <div className="space-y-5">
          {currentSong ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-slate-900">
                  <Image
                    src={currentSong.song.thumbnailUrl}
                    alt={currentSong.song.title}
                    fill
                    sizes="80px"
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
                    {messages.common.currentSong}
                  </p>
                  <p className="truncate text-sm font-semibold text-white">
                    {currentSong.song.title}
                  </p>
                  <p className="text-xs text-slate-400">
                    {currentSong.primarySinger.displayName}
                    {currentSong.secondarySinger
                      ? ` + ${currentSong.secondarySinger.displayName}`
                      : ""}
                  </p>
                </div>
              </div>

              {roomState.viewer.isJoined ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {CROWD_REACTIONS.slice(0, 5).map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() =>
                        void performAction({
                          type: "add-reaction",
                          emoji,
                        })
                      }
                      className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-base transition hover:bg-white/10"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {workspaceContent}
        </div>
      )}

      {shareModal}
    </main>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { useI18n } from "@/components/i18n-provider";
import type { AdminActionInput, AdminRoomSummary, AdminState } from "@/lib/admin-types";
import { PARTY_THEMES } from "@/lib/constants";
import type { Messages } from "@/lib/dictionaries";
import type { AppLocale } from "@/lib/locale";
import { buildLocalePath, formatRelativeShort } from "@/lib/utils";

function Surface({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-3xl border border-white/10 bg-slate-950/55 p-5 shadow-2xl shadow-slate-950/45 backdrop-blur ${className ?? ""}`}
    >
      {children}
    </section>
  );
}

function SummaryStat({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 px-4 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/85">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
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

function RoomMaintenanceCard({
  locale,
  room,
  messages,
  pendingKey,
  onSave,
  onRemoveParticipant,
  onDeleteRoom,
}: {
  locale: AppLocale;
  room: AdminRoomSummary;
  messages: Messages;
  pendingKey: string | null;
  onSave: (action: AdminActionInput, nextPendingKey: string) => Promise<void>;
  onRemoveParticipant: (action: AdminActionInput, nextPendingKey: string) => Promise<void>;
  onDeleteRoom: (action: AdminActionInput, nextPendingKey: string) => Promise<void>;
}) {
  const [name, setName] = useState(room.name);
  const [roomLocale, setRoomLocale] = useState<AdminRoomSummary["locale"]>(room.locale);
  const [themeId, setThemeId] = useState(room.themeId ?? "");
  const [customTheme, setCustomTheme] = useState(room.customTheme ?? "");

  const themeOptions = useMemo(
    () =>
      PARTY_THEMES.map((theme) => ({
        id: theme.id,
        label: theme.name[locale],
      })),
    [locale],
  );

  const saveKey = `save-room:${room.id}`;
  const deleteKey = `delete-room:${room.id}`;

  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-white">{room.name}</h3>
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold tracking-[0.24em] text-slate-200">
              {room.code}
            </span>
            <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">
              {room.locale}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-300">
            {messages.admin.roomCurrent}: {room.currentSongTitle ?? "-"}
          </p>
          <p className="mt-2 text-xs text-slate-400">
            {formatRelativeShort(room.updatedAt, locale)}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-200">
            <span className="rounded-full bg-white/6 px-3 py-1">
              {messages.admin.roomParticipants}: {room.participantCount}
            </span>
            <span className="rounded-full bg-white/6 px-3 py-1">
              {messages.admin.roomQueue}: {room.queuedCount}
            </span>
            <span className="rounded-full bg-white/6 px-3 py-1">
              {messages.admin.roomHistory}: {room.historyCount}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (window.confirm(`${messages.admin.deleteRoomConfirm}\n\n${room.name} (${room.code})`)) {
              void onDeleteRoom(
                {
                  type: "delete-room",
                  roomId: room.id,
                },
                deleteKey,
              );
            }
          }}
          disabled={pendingKey === deleteKey}
          className="rounded-full border border-rose-400/25 bg-rose-400/10 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/15 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {messages.admin.deleteRoom}
        </button>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-white/8 bg-slate-950/35 p-4">
          <p className="text-sm font-semibold text-white">{messages.admin.roomSettingsTitle}</p>
          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void onSave(
                {
                  type: "update-room-settings",
                  roomId: room.id,
                  name,
                  locale: roomLocale,
                  themeId: themeId || null,
                  customTheme: customTheme.trim() || null,
                },
                saveKey,
              );
            }}
          >
            <label className="block space-y-2">
              <span className="text-sm text-slate-200">{messages.admin.roomNameLabel}</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/60"
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm text-slate-200">{messages.admin.roomLocaleLabel}</span>
              <select
                value={roomLocale}
                onChange={(event) => setRoomLocale(event.target.value as AdminRoomSummary["locale"])}
                className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/60"
              >
                <option value="en">{messages.admin.localeEnglish}</option>
                <option value="ja">{messages.admin.localeJapanese}</option>
              </select>
            </label>

            <label className="block space-y-2">
              <span className="text-sm text-slate-200">{messages.admin.roomThemeLabel}</span>
              <select
                value={themeId}
                onChange={(event) => setThemeId(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/60"
              >
                <option value="">{messages.admin.noTheme}</option>
                {themeOptions.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-2">
              <span className="text-sm text-slate-200">{messages.admin.roomCustomThemeLabel}</span>
              <input
                value={customTheme}
                onChange={(event) => setCustomTheme(event.target.value)}
                placeholder={messages.admin.roomCustomThemePlaceholder}
                className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/60"
              />
            </label>

            <button
              type="submit"
              disabled={pendingKey === saveKey || name.trim().length === 0}
              className="rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-400 to-fuchsia-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-65"
            >
              {pendingKey === saveKey ? messages.common.loading : messages.admin.saveRoom}
            </button>
          </form>
        </div>

        <div className="rounded-2xl border border-white/8 bg-slate-950/35 p-4">
          <p className="text-sm font-semibold text-white">{messages.admin.participantsTitle}</p>
          <div className="mt-4 space-y-3">
            {room.participants.length === 0 ? (
              <p className="text-sm text-slate-400">{messages.admin.noParticipants}</p>
            ) : (
              room.participants.map((participant) => {
                const removeKey = `remove-participant:${room.id}:${participant.id}`;

                return (
                  <div
                    key={participant.id}
                    className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/5 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-white">{participant.displayName}</p>
                        {participant.isHost ? (
                          <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold text-amber-100">
                            {messages.common.host}
                          </span>
                        ) : null}
                        <span
                          className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                            participant.isPresent
                              ? "border border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                              : "border border-white/10 bg-white/6 text-slate-300"
                          }`}
                        >
                          {participant.isPresent ? messages.common.online : messages.common.offline}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        {messages.admin.lastSeenLabel}: {formatRelativeShort(participant.lastSeenAt, locale)}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `${messages.admin.removeParticipantConfirm}\n\n${participant.displayName}`,
                          )
                        ) {
                          void onRemoveParticipant(
                            {
                              type: "remove-participant",
                              roomId: room.id,
                              profileId: participant.id,
                            },
                            removeKey,
                          );
                        }
                      }}
                      disabled={pendingKey === removeKey}
                      className="rounded-full border border-rose-400/25 bg-rose-400/10 px-4 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-400/15 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {messages.admin.removeParticipant}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function AdminClient({ locale }: { locale: AppLocale }) {
  const { messages } = useI18n();
  const [adminState, setAdminState] = useState<AdminState | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const applyState = useCallback((payload: AdminState) => {
    setAdminState(payload);
    setError(null);

    if (!payload.authenticated) {
      setPassword("");
    }
  }, []);

  const refreshState = useCallback(
    async (showLoading = false) => {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const response = await fetch("/api/admin/state", {
          cache: "no-store",
        });
        const payload = await readJson<AdminState>(response);
        applyState(payload);
      } catch (caughtError) {
        setError(
          caughtError instanceof Error ? caughtError.message : messages.errors.generic,
        );
      } finally {
        setLoading(false);
      }
    },
    [applyState, messages.errors.generic],
  );

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void refreshState(true);
    }, 0);

    return () => {
      window.clearTimeout(initialLoad);
    };
  }, [refreshState]);

  const totalParticipants = useMemo(
    () => adminState?.rooms.reduce((sum, room) => sum + room.participantCount, 0) ?? 0,
    [adminState?.rooms],
  );
  const totalQueued = useMemo(
    () => adminState?.rooms.reduce((sum, room) => sum + room.queuedCount, 0) ?? 0,
    [adminState?.rooms],
  );

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingKey("login");
    setError(null);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          password,
        }),
      });

      const payload = await readJson<AdminState>(response);
      applyState(payload);
      setPassword("");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : messages.errors.generic,
      );
    } finally {
      setPendingKey(null);
      setLoading(false);
    }
  }

  async function handleLogout() {
    setPendingKey("logout");
    setError(null);

    try {
      const response = await fetch("/api/admin/logout", {
        method: "POST",
      });

      const payload = await readJson<AdminState>(response);
      applyState(payload);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : messages.errors.generic,
      );
    } finally {
      setPendingKey(null);
    }
  }

  async function runAction(action: AdminActionInput, nextPendingKey: string) {
    setPendingKey(nextPendingKey);
    setError(null);

    try {
      const response = await fetch("/api/admin/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(action),
      });

      const payload = await readJson<AdminState>(response);
      applyState(payload);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : messages.errors.generic,
      );
    } finally {
      setPendingKey(null);
    }
  }

  async function handleRefresh() {
    setPendingKey("refresh");
    await refreshState(true);
    setPendingKey(null);
  }

  if (loading && !adminState) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-10 text-sm text-slate-200">
        {messages.common.loading}
      </main>
    );
  }

  if (!adminState) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <Surface className="text-center">
          <p className="text-lg font-semibold text-white">{error ?? messages.errors.generic}</p>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            className="mt-4 rounded-full border border-cyan-300/25 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
          >
            {messages.common.refresh}
          </button>
        </Surface>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 px-5 py-5 shadow-lg shadow-slate-950/30 backdrop-blur md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300/85">
            {messages.appName}
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
            {messages.admin.title}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            {messages.admin.subtitle}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={buildLocalePath(locale)}
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
          >
            {messages.admin.backHome}
          </Link>
          <LocaleSwitcher locale={locale} />
          {adminState.authenticated ? (
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={pendingKey === "logout"}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {messages.admin.signOut}
            </button>
          ) : null}
        </div>
      </header>

      {error ? (
        <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {!adminState.configured ? (
        <Surface className="max-w-3xl">
          <p className="text-lg font-semibold text-white">
            {messages.admin.notConfiguredTitle}
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            {messages.admin.notConfiguredHint}
          </p>
        </Surface>
      ) : !adminState.authenticated ? (
        <Surface className="max-w-3xl">
          <p className="text-lg font-semibold text-white">{messages.admin.signIn}</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {messages.admin.passwordHint}
          </p>

          <form className="mt-5 space-y-4" onSubmit={handleLogin}>
            <label className="block space-y-2">
              <span className="text-sm text-slate-200">{messages.admin.passwordLabel}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/60"
                autoComplete="current-password"
              />
            </label>

            <button
              type="submit"
              disabled={pendingKey === "login" || password.trim().length === 0}
              className="rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-400 to-fuchsia-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-65"
            >
              {pendingKey === "login" ? messages.common.loading : messages.admin.signIn}
            </button>
          </form>
        </Surface>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <SummaryStat label={messages.admin.roomsTitle} value={adminState.rooms.length} />
            <SummaryStat label={messages.admin.roomParticipants} value={totalParticipants} />
            <SummaryStat label={messages.admin.roomQueue} value={totalQueued} />
          </div>

          <Surface>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-lg font-semibold text-white">{messages.admin.roomsTitle}</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {messages.admin.roomsHint}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={pendingKey === "refresh"}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {messages.common.refresh}
              </button>
            </div>

            <div className="mt-5 space-y-4">
              {adminState.rooms.length === 0 ? (
                <p className="text-sm text-slate-400">{messages.admin.noRooms}</p>
              ) : (
                adminState.rooms.map((room) => (
                  <RoomMaintenanceCard
                    key={`${room.id}:${room.updatedAt}`}
                    locale={locale}
                    room={room}
                    messages={messages}
                    pendingKey={pendingKey}
                    onSave={runAction}
                    onRemoveParticipant={runAction}
                    onDeleteRoom={runAction}
                  />
                ))
              )}
            </div>
          </Surface>
        </>
      )}
    </main>
  );
}

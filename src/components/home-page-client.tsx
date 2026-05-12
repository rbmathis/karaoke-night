"use client";

import { Music4, Sparkles, Tv2, UsersRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { useI18n } from "@/components/i18n-provider";
import type { AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

type PendingForm = "create" | "join" | null;

function Surface({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-3xl border border-white/10 bg-slate-950/55 p-6 shadow-2xl shadow-slate-950/45 backdrop-blur",
        className,
      )}
    >
      {children}
    </section>
  );
}

function featureIcon(index: number) {
  const icons = [
    <UsersRound key="users" className="h-5 w-5 text-cyan-300" />,
    <Tv2 key="tv" className="h-5 w-5 text-fuchsia-300" />,
    <Sparkles key="sparkles" className="h-5 w-5 text-amber-300" />,
    <Music4 key="music" className="h-5 w-5 text-emerald-300" />,
  ];

  return icons[index % icons.length];
}

async function readResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; redirectTo?: string }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Something went wrong.");
  }

  return payload;
}

export function HomePageClient({ locale }: { locale: AppLocale }) {
  const router = useRouter();
  const { messages } = useI18n();
  const [displayName, setDisplayName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [joinDisplayName, setJoinDisplayName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [pendingForm, setPendingForm] = useState<PendingForm>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingForm("create");
    setError(null);

    try {
      const response = await fetch("/api/rooms/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          displayName,
          roomName,
          locale,
        }),
      });

      const payload = await readResponse(response);
      router.push(payload?.redirectTo ?? `/${locale}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : messages.errors.generic,
      );
    } finally {
      setPendingForm(null);
    }
  }

  async function handleJoin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingForm("join");
    setError(null);

    try {
      const response = await fetch("/api/rooms/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: roomCode,
          displayName: joinDisplayName,
          locale,
        }),
      });

      const payload = await readResponse(response);
      router.push(payload?.redirectTo ?? `/${locale}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : messages.errors.generic,
      );
    } finally {
      setPendingForm(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 px-5 py-5 backdrop-blur md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-cyan-300/90">
            {messages.home.kicker}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
            {messages.home.title}
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
            {messages.home.description}
          </p>
        </div>
        <LocaleSwitcher locale={locale} />
      </header>

      {error ? (
        <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-6 md:grid-cols-2">
          <Surface>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">
              {messages.home.hostCard}
            </p>
            <form className="mt-4 space-y-4" onSubmit={handleCreate}>
              <label className="block space-y-2">
                <span className="text-sm text-slate-200">
                  {messages.home.displayName}
                </span>
                <input
                  required
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none ring-0 transition focus:border-cyan-400/60"
                  placeholder="DJ Chorus"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm text-slate-200">
                  {messages.home.roomName}
                </span>
                <input
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400/60"
                  placeholder={messages.home.roomNameHint}
                />
              </label>

              <button
                type="submit"
                disabled={pendingForm === "create"}
                className="w-full rounded-2xl bg-gradient-to-r from-cyan-400 via-sky-400 to-fuchsia-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {pendingForm === "create"
                  ? messages.common.loading
                  : messages.home.startParty}
              </button>
            </form>
          </Surface>

          <Surface>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-fuchsia-300">
              {messages.home.joinCard}
            </p>
            <form className="mt-4 space-y-4" onSubmit={handleJoin}>
              <label className="block space-y-2">
                <span className="text-sm text-slate-200">
                  {messages.home.displayName}
                </span>
                <input
                  required
                  value={joinDisplayName}
                  onChange={(event) => setJoinDisplayName(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm text-white outline-none transition focus:border-fuchsia-400/60"
                  placeholder="Harmony Hero"
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm text-slate-200">
                  {messages.home.roomCode}
                </span>
                <input
                  required
                  value={roomCode}
                  onChange={(event) => setRoomCode(event.target.value.toUpperCase())}
                  className="w-full rounded-2xl border border-white/10 bg-slate-900/80 px-4 py-3 text-sm uppercase tracking-[0.3em] text-white outline-none transition focus:border-fuchsia-400/60"
                  placeholder="A7K9M"
                />
              </label>

              <button
                type="submit"
                disabled={pendingForm === "join"}
                className="w-full rounded-2xl border border-fuchsia-300/40 bg-fuchsia-400/10 px-4 py-3 text-sm font-semibold text-fuchsia-100 transition hover:bg-fuchsia-400/20 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {pendingForm === "join"
                  ? messages.common.loading
                  : messages.home.joinParty}
              </button>
            </form>
          </Surface>
        </div>

        <Surface className="flex flex-col gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-300">
              {messages.home.featuresTitle}
            </p>
            <div className="mt-4 space-y-3">
              {messages.home.features.map((feature, index) => (
                <div
                  key={feature}
                  className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/5 px-4 py-3"
                >
                  <div className="mt-0.5 rounded-xl bg-white/8 p-2">
                    {featureIcon(index)}
                  </div>
                  <p className="text-sm leading-6 text-slate-200">{feature}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/8 p-4 text-sm leading-6 text-cyan-50">
            <p className="font-semibold text-cyan-100">{messages.appName}</p>
            <p className="mt-2 text-cyan-50/85">
              SQLite-backed song history and favorites, host-friendly queue moderation,
              and a cast-ready TV view are built into the app foundation.
            </p>
          </div>
        </Surface>
      </div>
    </main>
  );
}

"use client";

import { Sparkles } from "lucide-react";
import Image from "next/image";
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
      <header className="relative overflow-hidden rounded-3xl border border-amber-200/15 bg-slate-950/80 px-6 py-8 shadow-2xl shadow-slate-950/60 sm:px-8 sm:py-10">
        <Image
          src="/images/family-karaoke-hero.jpg"
          alt="Family Night Karaoke"
          fill
          priority
          sizes="(max-width: 1280px) 100vw, 1280px"
          className="object-cover object-right opacity-85"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950/95 via-slate-950/80 to-slate-950/25" />
        <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-amber-300/25 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-amber-200">
              <Sparkles className="h-3.5 w-3.5" />
              {messages.home.kicker}
            </p>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white drop-shadow sm:text-5xl">
              {messages.home.title}
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-slate-200 sm:text-base">
              {messages.home.description}
            </p>
          </div>
          <div className="shrink-0">
            <LocaleSwitcher locale={locale} />
          </div>
        </div>
      </header>

      {error ? (
        <div className="rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

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
    </main>
  );
}

"use client";

import { Languages } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { COOKIE_NAMES } from "@/lib/constants";
import { isSupportedLocale, type AppLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

export function LocaleSwitcher({
  locale,
  className,
}: {
  locale: AppLocale;
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  function navigate(nextLocale: AppLocale) {
    const segments = pathname.split("/");

    if (segments[1] && isSupportedLocale(segments[1])) {
      segments[1] = nextLocale;
    } else {
      segments.splice(1, 0, nextLocale);
    }

    const nextPath = segments.join("/") || `/${nextLocale}`;
    document.cookie = `${COOKIE_NAMES.locale}=${nextLocale}; max-age=31536000; path=/; samesite=lax`;
    router.replace(nextPath);
  }

  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 py-2 text-sm text-slate-200 shadow-lg shadow-slate-950/30 backdrop-blur",
        className,
      )}
    >
      <Languages className="h-4 w-4 text-cyan-300" />
      <select
        value={locale}
        onChange={(event) => navigate(event.target.value as AppLocale)}
        className="bg-transparent text-sm outline-none"
        aria-label="Language"
      >
        <option value="en" className="bg-slate-950 text-slate-100">
          English
        </option>
        <option value="ja" className="bg-slate-950 text-slate-100">
          日本語
        </option>
      </select>
    </label>
  );
}

export const SUPPORTED_LOCALES = ["en", "ja"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

export function isSupportedLocale(value: string): value is AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale);
}

export function normalizeLocale(value?: string | null): AppLocale {
  if (!value) {
    return DEFAULT_LOCALE;
  }

  const lowered = value.toLowerCase();

  if (lowered.startsWith("ja")) {
    return "ja";
  }

  if (lowered.startsWith("en")) {
    return "en";
  }

  return DEFAULT_LOCALE;
}

export function resolvePreferredLocale(
  cookieLocale?: string | null,
  acceptLanguage?: string | null,
): AppLocale {
  if (cookieLocale) {
    return normalizeLocale(cookieLocale);
  }

  if (!acceptLanguage) {
    return DEFAULT_LOCALE;
  }

  const ranked = acceptLanguage
    .split(",")
    .map((entry) => entry.trim().split(";")[0])
    .filter(Boolean);

  for (const candidate of ranked) {
    const locale = normalizeLocale(candidate);

    if (isSupportedLocale(locale)) {
      return locale;
    }
  }

  return DEFAULT_LOCALE;
}

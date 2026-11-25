import { notFound, redirect } from "next/navigation";

import { isSupportedLocale } from "@/lib/locale";

export default async function LocaleHomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  redirect(`/api/tv?locale=${locale}`);
}

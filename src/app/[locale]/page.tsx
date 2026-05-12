import { notFound } from "next/navigation";

import { HomePageClient } from "@/components/home-page-client";
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

  return <HomePageClient locale={locale} />;
}

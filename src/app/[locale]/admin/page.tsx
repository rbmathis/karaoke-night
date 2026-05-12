import { notFound } from "next/navigation";

import { AdminClient } from "@/components/admin-client";
import { isSupportedLocale } from "@/lib/locale";

export default async function AdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  return <AdminClient locale={locale} />;
}

import { notFound, redirect } from "next/navigation";

import { isSupportedLocale } from "@/lib/locale";
import { buildLocalePath } from "@/lib/utils";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  redirect(buildLocalePath(locale, `/room/${code.toUpperCase()}/singer`));
}

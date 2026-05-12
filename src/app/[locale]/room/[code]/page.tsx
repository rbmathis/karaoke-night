import { notFound } from "next/navigation";

import { RoomClient } from "@/components/room-client";
import { isSupportedLocale } from "@/lib/locale";

export default async function GuestRoomPage({
  params,
}: {
  params: Promise<{ locale: string; code: string }>;
}) {
  const { locale, code } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  return <RoomClient locale={locale} code={code.toUpperCase()} mode="guest" />;
}

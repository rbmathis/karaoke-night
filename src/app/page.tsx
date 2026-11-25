import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { COOKIE_NAMES } from "@/lib/constants";
import { resolvePreferredLocale } from "@/lib/locale";

export default async function RootPage() {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const locale = resolvePreferredLocale(
    cookieStore.get(COOKIE_NAMES.locale)?.value,
    headerStore.get("accept-language"),
  );

  redirect(`/api/tv?locale=${locale}`);
}

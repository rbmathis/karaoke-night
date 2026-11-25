import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { COOKIE_NAMES } from "@/lib/constants";
import { SUPPORTED_LOCALES, type AppLocale } from "@/lib/locale";
import { createDeviceToken } from "@/lib/utils";
import { getOrCreateSingleRoom } from "@/server/room-service";
import {
  getCookieOptions,
  getPublicRedirectUrl,
  errorResponse,
} from "@/server/route-utils";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedLocale = url.searchParams.get("locale");
    const locale: AppLocale = SUPPORTED_LOCALES.includes(requestedLocale as AppLocale)
      ? (requestedLocale as AppLocale)
      : "en";
    const cookieStore = await cookies();
    const deviceToken =
      cookieStore.get(COOKIE_NAMES.deviceToken)?.value ?? createDeviceToken();
    const { roomCode } = await getOrCreateSingleRoom(locale, deviceToken);

    const response = NextResponse.redirect(
      getPublicRedirectUrl(request, `/${locale}/room/${roomCode}/tv`),
    );
    response.cookies.set(COOKIE_NAMES.deviceToken, deviceToken, getCookieOptions(request));
    response.cookies.set(COOKIE_NAMES.locale, locale, getCookieOptions(request));
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

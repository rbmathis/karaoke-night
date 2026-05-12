import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { COOKIE_NAMES } from "@/lib/constants";
import { createRoomSchema } from "@/lib/room-types";
import { buildLocalePath, createDeviceToken } from "@/lib/utils";
import { createRoom } from "@/server/room-service";
import { getCookieOptions, errorResponse } from "@/server/route-utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = createRoomSchema.parse(await request.json());
    const cookieStore = await cookies();
    const deviceToken =
      cookieStore.get(COOKIE_NAMES.deviceToken)?.value ?? createDeviceToken();
    const result = await createRoom(payload, deviceToken);

    const response = NextResponse.json({
      roomCode: result.roomCode,
      redirectTo: buildLocalePath(payload.locale, `/room/${result.roomCode}/host`),
    });

    response.cookies.set(COOKIE_NAMES.deviceToken, deviceToken, getCookieOptions(request));
    response.cookies.set(COOKIE_NAMES.locale, payload.locale, getCookieOptions(request));

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { COOKIE_NAMES } from "@/lib/constants";
import { getRoomState, runRoomAction } from "@/server/room-service";
import { errorResponse } from "@/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/rooms/[code]/state">,
) {
  try {
    const { code } = await ctx.params;
    const cookieStore = await cookies();
    const deviceToken = cookieStore.get(COOKIE_NAMES.deviceToken)?.value;

    if (deviceToken) {
      await runRoomAction(code, { type: "heartbeat" }, deviceToken);
    }

    const roomState = await getRoomState(code, deviceToken);

    if (!roomState) {
      return NextResponse.json(
        {
          error: "That room was not found.",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json(roomState);
  } catch (error) {
    return errorResponse(error);
  }
}

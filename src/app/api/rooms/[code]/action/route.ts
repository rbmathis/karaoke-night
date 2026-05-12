import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { COOKIE_NAMES } from "@/lib/constants";
import { roomActionSchema } from "@/lib/room-types";
import { publishRoomEvent } from "@/server/room-hub";
import { getRoomState, runRoomAction } from "@/server/room-service";
import { errorResponse } from "@/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/rooms/[code]/action">,
) {
  try {
    const { code } = await ctx.params;
    const payload = roomActionSchema.parse(await request.json());
    const cookieStore = await cookies();
    const deviceToken = cookieStore.get(COOKIE_NAMES.deviceToken)?.value;

    await runRoomAction(code, payload, deviceToken);
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

    if (payload.type !== "heartbeat") {
      publishRoomEvent(code, payload.type);
    }

    return NextResponse.json(roomState);
  } catch (error) {
    return errorResponse(error);
  }
}

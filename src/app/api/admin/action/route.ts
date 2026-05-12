import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { adminActionSchema } from "@/lib/admin-types";
import { COOKIE_NAMES } from "@/lib/constants";
import { requireAdminSession } from "@/server/admin-auth";
import {
  deleteRoomById,
  getAdminDashboardState,
  removeParticipantFromRoom,
  updateRoomSettings,
} from "@/server/admin-service";
import { errorResponse } from "@/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    requireAdminSession(cookieStore.get(COOKIE_NAMES.adminSession)?.value);

    const payload = adminActionSchema.parse(await request.json());

    switch (payload.type) {
      case "delete-room":
        deleteRoomById(payload.roomId);
        break;
      case "update-room-settings":
        updateRoomSettings({
          roomId: payload.roomId,
          name: payload.name,
          locale: payload.locale,
          themeId: payload.themeId,
          customTheme: payload.customTheme,
        });
        break;
      case "remove-participant":
        removeParticipantFromRoom(payload.roomId, payload.profileId);
        break;
    }

    return NextResponse.json(getAdminDashboardState());
  } catch (error) {
    return errorResponse(error);
  }
}

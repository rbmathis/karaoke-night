import { NextResponse } from "next/server";

import { errorResponse } from "@/server/route-utils";
import { listRooms } from "@/server/room-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json({ rooms: listRooms() });
  } catch (error) {
    return errorResponse(error);
  }
}

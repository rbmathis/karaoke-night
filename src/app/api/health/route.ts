import { NextResponse } from "next/server";

import { getHealthSnapshot } from "@/server/room-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getHealthSnapshot());
}

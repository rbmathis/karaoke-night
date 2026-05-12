import { NextResponse } from "next/server";

import { youtubeSearchSchema } from "@/lib/room-types";
import { searchYouTubeKaraoke } from "@/server/youtube-service";
import { errorResponse } from "@/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const payload = youtubeSearchSchema.parse({
      q: url.searchParams.get("q"),
      locale: url.searchParams.get("locale"),
    });

    const results = await searchYouTubeKaraoke(payload.q, payload.locale);

    return NextResponse.json({
      results,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

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
      pageToken: url.searchParams.get("pageToken") || undefined,
    });

    const { results, nextPageToken } = await searchYouTubeKaraoke(
      payload.q,
      payload.locale,
      payload.pageToken,
    );

    return NextResponse.json({
      results,
      nextPageToken,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

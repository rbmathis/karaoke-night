import { NextResponse } from "next/server";

import { COOKIE_NAMES } from "@/lib/constants";
import { getAdminCookieOptions, isAdminConfigured } from "@/server/admin-auth";
import { getLoggedOutAdminState } from "@/server/admin-service";
import { errorResponse } from "@/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const response = NextResponse.json(getLoggedOutAdminState(isAdminConfigured()));

    response.cookies.set(COOKIE_NAMES.adminSession, "", {
      ...getAdminCookieOptions(request),
      maxAge: 0,
    });

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

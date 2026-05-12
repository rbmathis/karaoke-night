import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { COOKIE_NAMES } from "@/lib/constants";
import { isAdminConfigured, verifyAdminSessionValue } from "@/server/admin-auth";
import { getAdminDashboardState, getLoggedOutAdminState } from "@/server/admin-service";
import { errorResponse } from "@/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const configured = isAdminConfigured();

    if (!configured) {
      return NextResponse.json(getLoggedOutAdminState(false));
    }

    const cookieStore = await cookies();
    const authenticated = verifyAdminSessionValue(
      cookieStore.get(COOKIE_NAMES.adminSession)?.value,
    );

    if (!authenticated) {
      return NextResponse.json(getLoggedOutAdminState(true));
    }

    return NextResponse.json(getAdminDashboardState());
  } catch (error) {
    return errorResponse(error);
  }
}

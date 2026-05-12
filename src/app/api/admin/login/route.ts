import { NextResponse } from "next/server";

import { adminLoginSchema } from "@/lib/admin-types";
import { COOKIE_NAMES } from "@/lib/constants";
import {
  assertAdminLoginAllowed,
  clearAdminLoginFailures,
  createAdminSessionValue,
  getAdminCookieOptions,
  recordFailedAdminLogin,
  verifyAdminPassword,
} from "@/server/admin-auth";
import { getAdminDashboardState } from "@/server/admin-service";
import { errorResponse } from "@/server/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertAdminLoginAllowed(request);
    const payload = adminLoginSchema.parse(await request.json());

    if (!verifyAdminPassword(payload.password)) {
      recordFailedAdminLogin(request);

      return NextResponse.json(
        {
          error: "The admin password was not correct.",
        },
        {
          status: 401,
        },
      );
    }

    clearAdminLoginFailures(request);

    const response = NextResponse.json(getAdminDashboardState());
    response.cookies.set(
      COOKIE_NAMES.adminSession,
      createAdminSessionValue(),
      getAdminCookieOptions(request),
    );

    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

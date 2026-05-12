import { NextResponse } from "next/server";

export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function shouldUseSecureCookies(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto");

  if (forwardedProto) {
    return forwardedProto
      .split(",")
      .some((value) => value.trim().toLowerCase() === "https");
  }

  return new URL(request.url).protocol === "https:";
}

export function getCookieOptions(request: Request) {
  return {
    path: "/",
    sameSite: "lax" as const,
    secure: shouldUseSecureCookies(request),
    maxAge: COOKIE_MAX_AGE,
  };
}

export function getErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return "Something went wrong. Please try again.";
}

export function getErrorStatus(error: unknown) {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = Number((error as { status?: unknown }).status);

    if (Number.isFinite(status) && status >= 400 && status <= 599) {
      return status;
    }
  }

  return 500;
}

export function errorResponse(error: unknown) {
  return NextResponse.json(
    {
      error: getErrorMessage(error),
    },
    {
      status: getErrorStatus(error),
    },
  );
}

import { NextResponse } from "next/server";

export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

export function getPublicOrigin(request: Request) {
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const requestOrigin = new URL(request.url);
  const hostHeader = firstHeaderValue(request.headers.get("host"));
  const originHeader = firstHeaderValue(request.headers.get("origin"));

  let publicHost = forwardedHost;

  if (!publicHost && hostHeader && !hostHeader.startsWith("0.0.0.0")) {
    publicHost = hostHeader;
  }

  if (!publicHost && originHeader) {
    try {
      const originUrl = new URL(originHeader);
      if (!originUrl.hostname.startsWith("0.0.0.0")) {
        publicHost = originUrl.host;
      }
    } catch {
      // Ignore malformed origin headers and use the request URL fallback.
    }
  }

  if (!publicHost && !["0.0.0.0", "::"].includes(requestOrigin.hostname)) {
    publicHost = requestOrigin.host;
  }

  if (!publicHost) {
    return null;
  }

  const protocol =
    forwardedProto ||
    (originHeader ? (() => {
      try {
        return new URL(originHeader).protocol;
      } catch {
        return requestOrigin.protocol;
      }
    })() : requestOrigin.protocol);

  return `${protocol.replace(/:$/, "")}://${publicHost}`;
}

export function getPublicRedirectUrl(request: Request, path: string) {
  const publicOrigin = getPublicOrigin(request);
  return publicOrigin ? new URL(path, publicOrigin).toString() : path;
}

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

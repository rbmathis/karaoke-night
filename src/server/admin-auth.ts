import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { getCookieOptions } from "@/server/route-utils";

const ADMIN_SESSION_MAX_AGE = 60 * 60 * 12;
const LOGIN_THROTTLE_BASE_MS = 2_000;
const LOGIN_THROTTLE_MAX_MS = 60_000;

type AdminLoginAttempt = {
  blockedUntil: number;
  failures: number;
};

declare global {
  var __karaokeAdminLoginAttempts: Map<string, AdminLoginAttempt> | undefined;
}

const loginAttempts = global.__karaokeAdminLoginAttempts ?? new Map<string, AdminLoginAttempt>();
global.__karaokeAdminLoginAttempts = loginAttempts;

function createPublicError(message: string, status = 400) {
  const error = new Error(message);
  Object.assign(error, {
    status,
  });
  return error;
}

function getAttemptKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return new URL(request.url).host;
}

function getAdminPassword() {
  return process.env.ADMIN_PASSWORD?.trim() || null;
}

function getAdminSecret() {
  const password = getAdminPassword();

  if (!password) {
    return null;
  }

  return createHash("sha256").update(`karaoke-night-admin:${password}`).digest();
}

function signAdminValue(prefix: string, value: string) {
  const secret = getAdminSecret();

  if (!secret) {
    throw createPublicError("Admin access is not configured. Add ADMIN_PASSWORD first.", 503);
  }

  return createHmac("sha256", secret).update(`${prefix}:${value}`).digest();
}

export function isAdminConfigured() {
  return Boolean(getAdminPassword());
}

export function assertAdminLoginAllowed(request: Request) {
  const attempt = loginAttempts.get(getAttemptKey(request));

  if (attempt && attempt.blockedUntil > Date.now()) {
    throw createPublicError("Too many failed admin sign-in attempts. Try again shortly.", 429);
  }
}

export function clearAdminLoginFailures(request: Request) {
  loginAttempts.delete(getAttemptKey(request));
}

export function recordFailedAdminLogin(request: Request) {
  const key = getAttemptKey(request);
  const current = loginAttempts.get(key);
  const failures = (current?.failures ?? 0) + 1;
  const delay = Math.min(LOGIN_THROTTLE_BASE_MS * failures, LOGIN_THROTTLE_MAX_MS);

  loginAttempts.set(key, {
    failures,
    blockedUntil: Date.now() + delay,
  });
}

export function verifyAdminPassword(password: string) {
  const expectedPassword = getAdminPassword();

  if (!expectedPassword) {
    throw createPublicError("Admin access is not configured. Add ADMIN_PASSWORD first.", 503);
  }

  const actualDigest = signAdminValue("password", password);
  const expectedDigest = signAdminValue("password", expectedPassword);

  return timingSafeEqual(actualDigest, expectedDigest);
}

export function createAdminSessionValue() {
  const issuedAt = Date.now().toString();
  const signature = signAdminValue("session", issuedAt).toString("base64url");
  return `${issuedAt}.${signature}`;
}

export function verifyAdminSessionValue(value?: string | null) {
  if (!value || !isAdminConfigured()) {
    return false;
  }

  const [issuedAtRaw, signatureRaw] = value.split(".", 2);

  if (!issuedAtRaw || !signatureRaw || !/^\d+$/.test(issuedAtRaw)) {
    return false;
  }

  const issuedAt = Number(issuedAtRaw);

  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > ADMIN_SESSION_MAX_AGE * 1000) {
    return false;
  }

  const expectedSignature = signAdminValue("session", issuedAtRaw);
  let actualSignature: Buffer;

  try {
    actualSignature = Buffer.from(signatureRaw, "base64url");
  } catch {
    return false;
  }

  if (actualSignature.length !== expectedSignature.length) {
    return false;
  }

  return timingSafeEqual(actualSignature, expectedSignature);
}

export function requireAdminSession(value?: string | null) {
  if (!verifyAdminSessionValue(value)) {
    throw createPublicError("Admin sign-in required.", 401);
  }
}

export function getAdminCookieOptions(request: Request) {
  return {
    ...getCookieOptions(request),
    httpOnly: true,
    maxAge: ADMIN_SESSION_MAX_AGE,
    sameSite: "strict" as const,
  };
}

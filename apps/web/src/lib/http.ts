import { NextResponse } from "next/server";

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" || message === "CSRF_REJECTED" || message === "PASSWORD_CHANGE_REQUIRED" ? 403 : message === "RATE_LIMITED" ? 429 : message.endsWith("NOT_FOUND") ? 404 : 400;
  return NextResponse.json({ error: message }, { status });
}

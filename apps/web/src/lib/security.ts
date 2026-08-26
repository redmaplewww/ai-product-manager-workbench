import "server-only";

type Attempt = { count: number; resetAt: number };
const loginAttempts = new Map<string, Attempt>();
const loginWindowMs = 15 * 60 * 1000;
const maxLoginFailures = 5;

function requestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) return origin;
  const referer = request.headers.get("referer");
  if (referer) return new URL(referer).origin;
  return null;
}

export function assertSameOrigin(request: Request) {
  const supplied = requestOrigin(request);
  if (!supplied && process.env.NODE_ENV !== "production") return;
  if (!supplied) throw new Error("CSRF_REJECTED");
  const source = new URL(supplied);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const expectedHost = forwardedHost || request.headers.get("host") || new URL(request.url).host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const expectedProtocol = `${forwardedProto || new URL(request.url).protocol.replace(":", "")}:`;
  if (source.host !== expectedHost || source.protocol !== expectedProtocol) throw new Error("CSRF_REJECTED");
}

function loginKey(request: Request, username: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `${forwarded || "local"}:${username.toLowerCase()}`;
}

export function assertLoginAllowed(request: Request, username: string) {
  const key = loginKey(request, username);
  const attempt = loginAttempts.get(key);
  if (!attempt) return;
  if (attempt.resetAt <= Date.now()) { loginAttempts.delete(key); return; }
  if (attempt.count >= maxLoginFailures) throw new Error("RATE_LIMITED");
}

export function recordLoginFailure(request: Request, username: string) {
  const key = loginKey(request, username);
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= Date.now()) loginAttempts.set(key, { count: 1, resetAt: Date.now() + loginWindowMs });
  else current.count += 1;
}

export function clearLoginFailures(request: Request, username: string) {
  loginAttempts.delete(loginKey(request, username));
}

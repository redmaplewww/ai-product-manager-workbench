import "server-only";
import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import "./env";
import { readState } from "./store";

const secret = new TextEncoder().encode(process.env.SESSION_SECRET || "pm-studio-development-secret-change-me");
const cookieName = "pm_studio_session";

export async function createSession(userId: string) {
  const token = await new SignJWT({ userId }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(secret);
  (await cookies()).set(cookieName, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
}

export async function clearSession() {
  (await cookies()).delete(cookieName);
}

export async function currentUser() {
  const token = (await cookies()).get(cookieName)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    const state = await readState();
    return state.users.find((user) => user.id === payload.userId) || null;
  } catch { return null; }
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function requireRole(roles: Array<"admin" | "editor" | "reviewer">) {
  const user = await requireUser();
  if (user.mustChangePassword) throw new Error("PASSWORD_CHANGE_REQUIRED");
  if (!roles.includes(user.role)) throw new Error("FORBIDDEN");
  return user;
}

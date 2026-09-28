import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "../generated/prisma/client.ts";
import { db } from "./db.ts";
import { env, isProd } from "./env.ts";
import { can, type Permission } from "./permissions.ts";

const secret = new TextEncoder().encode(env.JWT_SECRET);
const ACCESS_TTL = "15m";
const REFRESH_DAYS = 30;
export const REFRESH_COOKIE = "dc20_rt";
export const MAX_FAILED = 5;
export const LOCK_MINUTES = 15;

export type AuthUser = { id: string; roles: Role[] };

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function signAccess(user: AuthUser) {
  return new SignJWT({ roles: user.roles, typ: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(secret);
}

/** Short-lived token proving the SSC reg check passed; only good for setting a password. */
export async function signClaim(studentId: string) {
  return new SignJWT({ typ: "claim" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(studentId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret);
}

export async function verifyToken(token: string, typ: "access" | "claim") {
  const { payload } = await jwtVerify(token, secret, { algorithms: ["HS256"] });
  if (payload.typ !== typ || !payload.sub) throw new Error("wrong token type");
  return payload as { sub: string; roles?: Role[] };
}

/** Creates a session, sets the refresh cookie and returns an access token. */
export async function startSession(reply: FastifyReply, req: FastifyRequest, user: AuthUser) {
  const refresh = randomBytes(32).toString("base64url");
  await db.session.create({
    data: {
      studentId: user.id,
      tokenHash: sha256(refresh),
      userAgent: req.headers["user-agent"]?.slice(0, 200),
      expiresAt: new Date(Date.now() + REFRESH_DAYS * 864e5),
    },
  });
  reply.setCookie(REFRESH_COOKIE, refresh, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/auth",
    maxAge: REFRESH_DAYS * 86400,
  });
  return signAccess(user);
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return reply.code(401).send({ error: "unauthenticated" });
  try {
    const payload = await verifyToken(header.slice(7), "access");
    req.user = { id: payload.sub, roles: payload.roles ?? [] };
  } catch {
    return reply.code(401).send({ error: "unauthenticated" });
  }
}

export function requirePermission(perm: Permission) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(req, reply);
    if (reply.sent) return;
    if (!can(req.user!.roles, perm)) return reply.code(403).send({ error: "forbidden" });
  };
}

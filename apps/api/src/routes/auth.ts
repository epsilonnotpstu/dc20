import type { FastifyInstance, FastifyRequest } from "fastify";
import argon2 from "argon2";
import { z } from "zod";
import { db } from "../lib/db.ts";
import {
  LOCK_MINUTES,
  MAX_FAILED,
  REFRESH_COOKIE,
  sha256,
  signClaim,
  startSession,
  verifyToken,
} from "../lib/auth.ts";
import type { Student } from "../generated/prisma/client.ts";

const roll = z.string().trim().regex(/^\d{6,16}$/, "invalid roll");
const authLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

// Verifying against a dummy hash when the roll doesn't exist keeps response
// times equal, so rolls can't be enumerated by timing.
const DUMMY_HASH = await argon2.hash("dc20-timing-dummy");

async function recordFailure(s: Student) {
  const failed = s.failedLogins + 1;
  await db.student.update({
    where: { id: s.id },
    data: {
      failedLogins: failed >= MAX_FAILED ? 0 : failed,
      lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60e3) : s.lockedUntil,
    },
  });
}

const isLocked = (s: Student) => s.lockedUntil && s.lockedUntil > new Date();
const lockedError = { error: "locked", message: `Too many attempts. Try again in ${LOCK_MINUTES} minutes.` };
const invalidError = { error: "invalid_credentials" };

export async function authRoutes(app: FastifyInstance) {
  /** Step 1 of claim / reset: roll + SSC reg (or admin-issued claim code). */
  app.post("/auth/claim", { config: authLimit }, async (req, reply) => {
    const body = z.object({ roll, secret: z.string().trim().min(4).max(40) }).parse(req.body);
    const s = await db.student.findUnique({ where: { collegeRoll: body.roll } });
    if (!s || s.status === "suspended" || s.status === "deceased") {
      await argon2.verify(DUMMY_HASH, body.secret);
      return reply.code(401).send(invalidError);
    }
    if (isLocked(s)) return reply.code(429).send(lockedError);

    const codeValid = s.claimCodeHash && s.claimCodeExpiresAt && s.claimCodeExpiresAt > new Date();
    const ok =
      (s.sscRegHash && (await argon2.verify(s.sscRegHash, body.secret))) ||
      (codeValid && (await argon2.verify(s.claimCodeHash!, body.secret.toUpperCase())));
    if (!ok) {
      await recordFailure(s);
      return reply.code(401).send(invalidError);
    }
    await db.student.update({ where: { id: s.id }, data: { failedLogins: 0, lockedUntil: null } });
    return {
      claimToken: await signClaim(s.id),
      reset: s.status === "active",
      student: { name: s.name, photoUrl: s.photoUrl, collegeRoll: s.collegeRoll },
    };
  });

  /** Step 2: set a password. Activates unclaimed accounts; on reset, signs out every other device. */
  app.post("/auth/claim/complete", { config: authLimit }, async (req, reply) => {
    const body = z
      .object({ claimToken: z.string(), password: z.string().min(8).max(128) })
      .parse(req.body);
    let studentId: string;
    try {
      studentId = (await verifyToken(body.claimToken, "claim")).sub;
    } catch {
      return reply.code(401).send({ error: "claim_expired" });
    }
    const s = await db.student.findUniqueOrThrow({ where: { id: studentId } });
    const wasUnclaimed = s.status === "unclaimed";
    const updated = await db.student.update({
      where: { id: s.id },
      data: {
        passwordHash: await argon2.hash(body.password),
        status: wasUnclaimed ? "active" : s.status,
        claimedAt: s.claimedAt ?? new Date(),
        claimCodeHash: null,
        claimCodeExpiresAt: null,
      },
    });
    await db.session.updateMany({ where: { studentId: s.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await db.auditLog.create({
      data: { actorId: s.id, action: wasUnclaimed ? "account.claimed" : "account.password_reset", target: s.id },
    });
    const accessToken = await startSession(reply, req, { id: s.id, roles: updated.roles });
    return { accessToken, firstTime: wasUnclaimed };
  });

  app.post("/auth/login", { config: authLimit }, async (req, reply) => {
    const body = z.object({ roll, password: z.string().min(1).max(128) }).parse(req.body);
    const s = await db.student.findUnique({ where: { collegeRoll: body.roll } });
    if (!s?.passwordHash || s.status !== "active") {
      await argon2.verify(DUMMY_HASH, body.password);
      // Tell unclaimed users where to go instead — the roll alone is not secret.
      if (s?.status === "unclaimed") return reply.code(409).send({ error: "not_claimed" });
      return reply.code(401).send(invalidError);
    }
    if (isLocked(s)) return reply.code(429).send(lockedError);
    if (!(await argon2.verify(s.passwordHash, body.password))) {
      await recordFailure(s);
      return reply.code(401).send(invalidError);
    }
    await db.student.update({ where: { id: s.id }, data: { failedLogins: 0, lockedUntil: null } });
    return { accessToken: await startSession(reply, req, { id: s.id, roles: s.roles }) };
  });

  const readRefresh = (req: FastifyRequest) => req.cookies[REFRESH_COOKIE];

  /** Rotates the refresh token; roles are re-read so permission changes apply within one refresh. */
  app.post("/auth/refresh", async (req, reply) => {
    const token = readRefresh(req);
    if (!token) return reply.code(401).send({ error: "unauthenticated" });
    const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { student: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.student.status !== "active") {
      // A revoked token being reused means it leaked: revoke the whole family.
      if (session?.revokedAt) {
        await db.session.updateMany({ where: { studentId: session.studentId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      reply.clearCookie(REFRESH_COOKIE, { path: "/auth" });
      return reply.code(401).send({ error: "unauthenticated" });
    }
    await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    const user = { id: session.studentId, roles: session.student.roles };
    return { accessToken: await startSession(reply, req, user) };
  });

  app.post("/auth/logout", async (req, reply) => {
    const token = readRefresh(req);
    if (token) {
      await db.session.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
    }
    reply.clearCookie(REFRESH_COOKIE, { path: "/auth" });
    return { ok: true };
  });

  /** "I can't get in" / "someone else claimed my account" — goes to the admin queue. */
  app.post("/auth/report", { config: { rateLimit: { max: 3, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const body = z
      .object({ roll, contact: z.string().trim().min(5).max(120), message: z.string().trim().min(5).max(1000) })
      .parse(req.body);
    const s = await db.student.findUnique({ where: { collegeRoll: body.roll }, select: { id: true } });
    if (s) await db.claimReport.create({ data: { studentId: s.id, contact: body.contact, message: body.message } });
    return reply.code(202).send({ ok: true });
  });
}


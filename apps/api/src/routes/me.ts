import type { FastifyInstance } from "fastify";
import { z } from "zod";
import argon2 from "argon2";
import { db } from "../lib/db.ts";
import { requireAuth } from "../lib/auth.ts";
import { projectStudent } from "../lib/privacy.ts";
import { validateProfileData } from "../lib/fieldValidation.ts";
import { saveAvatar } from "../lib/storage.ts";
import type { Prisma } from "../generated/prisma/client.ts";

const visibility = z.enum(["members", "only_me", "admins"]);

export async function meRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/me", async (req) => {
    const [me, fields] = await Promise.all([
      db.student.update({ where: { id: req.user!.id }, data: { lastSeenAt: new Date() } }),
      db.fieldDefinition.findMany({ orderBy: { order: "asc" } }),
    ]);
    return projectStudent(req.user!, me, fields);
  });

  app.patch("/me", async (req, reply) => {
    const body = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        data: z.record(z.string(), z.unknown()).optional(),
        privacy: z.record(z.string(), visibility).optional(),
        hiddenFromDirectory: z.boolean().optional(),
        showOnline: z.boolean().optional(),
      })
      .parse(req.body);

    const [me, fields] = await Promise.all([
      db.student.findUniqueOrThrow({ where: { id: req.user!.id } }),
      db.fieldDefinition.findMany({ orderBy: { order: "asc" } }),
    ]);
    const { clean, errors } = validateProfileData(body.data ?? {}, fields, { asAdmin: false });

    const byKey = new Map(fields.map((f) => [f.key, f]));
    const privacy = { ...(me.privacy as Record<string, string>) };
    for (const [key, v] of Object.entries(body.privacy ?? {})) {
      const f = byKey.get(key);
      if (!f) errors[key] = "unknown field";
      else if (f.visibilityLocked) errors[key] = "visibility is fixed by admins";
      else privacy[key] = v;
    }
    if (Object.keys(errors).length) return reply.code(400).send({ error: "validation", fields: errors });

    const data = { ...(me.data as Record<string, unknown>) };
    for (const [k, v] of Object.entries(clean)) {
      if (v === null) delete data[k];
      else data[k] = v;
    }
    const updated = await db.student.update({
      where: { id: me.id },
      data: {
        name: body.name,
        data: data as Prisma.InputJsonValue,
        privacy,
        hiddenFromDirectory: body.hiddenFromDirectory,
        showOnline: body.showOnline,
      },
    });
    return projectStudent(req.user!, updated, fields);
  });

  app.post("/me/photo", async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
    if (!file || !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) {
      return reply.code(400).send({ error: "upload a JPEG, PNG or WebP image" });
    }
    const buf = await file.toBuffer();
    let photoUrl: string;
    try {
      photoUrl = await saveAvatar(buf);
    } catch {
      return reply.code(400).send({ error: "could not read image" });
    }
    await db.student.update({ where: { id: req.user!.id }, data: { photoUrl } });
    return { photoUrl };
  });

  app.post("/me/password", async (req, reply) => {
    const body = z
      .object({ current: z.string().min(1), next: z.string().min(8).max(128) })
      .parse(req.body);
    const me = await db.student.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!me.passwordHash || !(await argon2.verify(me.passwordHash, body.current))) {
      return reply.code(400).send({ error: "wrong_password" });
    }
    await db.student.update({ where: { id: me.id }, data: { passwordHash: await argon2.hash(body.next) } });
    await db.auditLog.create({ data: { actorId: me.id, action: "account.password_changed", target: me.id } });
    return { ok: true };
  });
}

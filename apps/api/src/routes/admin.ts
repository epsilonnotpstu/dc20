import type { FastifyInstance } from "fastify";
import { randomInt } from "node:crypto";
import argon2 from "argon2";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { requirePermission } from "../lib/auth.ts";

const fieldBody = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9]{1,39}$/, "camelCase letters/digits, start with a letter"),
  labelEn: z.string().trim().min(1).max(60),
  labelBn: z.string().trim().min(1).max(60),
  type: z.enum(["text", "textarea", "number", "date", "select", "multiselect", "phone", "email", "url", "tags"]),
  options: z.array(z.string().trim().min(1).max(60)).max(100).default([]),
  group: z.string().trim().min(1).max(40).default("About"),
  isFilterable: z.boolean().default(false),
  filterUi: z.enum(["dropdown", "chips", "search", "range"]).default("dropdown"),
  isEditableByUser: z.boolean().default(true),
  defaultVisibility: z.enum(["members", "only_me", "admins"]).default("members"),
  visibilityLocked: z.boolean().default(false),
});

// Unambiguous characters only (no 0/O, 1/I/L).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export async function adminRoutes(app: FastifyInstance) {
  const fieldsGuard = { preHandler: requirePermission("fields.manage") };

  app.post("/admin/fields", fieldsGuard, async (req, reply) => {
    const body = fieldBody.parse(req.body);
    if (await db.fieldDefinition.findUnique({ where: { key: body.key } })) {
      return reply.code(409).send({ error: "key_exists" });
    }
    const last = await db.fieldDefinition.findFirst({ orderBy: { order: "desc" } });
    const field = await db.fieldDefinition.create({ data: { ...body, order: (last?.order ?? 0) + 10 } });
    await db.auditLog.create({ data: { actorId: req.user!.id, action: "field.created", target: field.key, meta: body } });
    return field;
  });

  app.patch("/admin/fields/:key", fieldsGuard, async (req) => {
    const { key } = z.object({ key: z.string() }).parse(req.params);
    const body = fieldBody.omit({ key: true }).partial().parse(req.body);
    const field = await db.fieldDefinition.update({ where: { key }, data: body });
    await db.auditLog.create({ data: { actorId: req.user!.id, action: "field.updated", target: key, meta: body } });
    return field;
  });

  app.post("/admin/fields/reorder", fieldsGuard, async (req) => {
    const { keys } = z.object({ keys: z.array(z.string()).max(200) }).parse(req.body);
    await db.$transaction(keys.map((key, i) => db.fieldDefinition.update({ where: { key }, data: { order: i * 10 } })));
    return { ok: true };
  });

  /** Deleting a definition hides the field; stored values stay in `data` so it can be restored. */
  app.delete("/admin/fields/:key", fieldsGuard, async (req, reply) => {
    const { key } = z.object({ key: z.string() }).parse(req.params);
    const field = await db.fieldDefinition.findUnique({ where: { key } });
    if (!field) return reply.code(404).send({ error: "not_found" });
    if (field.fromSeed) return reply.code(400).send({ error: "college_sheet_fields_cannot_be_deleted" });
    await db.fieldDefinition.delete({ where: { key } });
    await db.auditLog.create({ data: { actorId: req.user!.id, action: "field.deleted", target: key } });
    return { ok: true };
  });

  /** For students with no SSC reg on file, or who lost access. Valid 7 days, shown once. */
  app.post("/admin/students/:id/claim-code", { preHandler: requirePermission("students.issue_claim_code") }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    const s = await db.student.update({
      where: { id },
      data: {
        claimCodeHash: await argon2.hash(code),
        claimCodeExpiresAt: new Date(Date.now() + 7 * 864e5),
        failedLogins: 0,
        lockedUntil: null,
      },
    });
    await db.auditLog.create({ data: { actorId: req.user!.id, action: "student.claim_code_issued", target: s.id } });
    return { code, collegeRoll: s.collegeRoll, expiresAt: s.claimCodeExpiresAt };
  });

  app.get("/admin/claim-reports", { preHandler: requirePermission("reports.review") }, async () =>
    db.claimReport.findMany({
      where: { resolvedAt: null },
      orderBy: { createdAt: "desc" },
      include: { student: { select: { id: true, name: true, collegeRoll: true, status: true } } },
    }),
  );

  app.post("/admin/claim-reports/:id/resolve", { preHandler: requirePermission("reports.review") }, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    await db.claimReport.update({ where: { id }, data: { resolvedAt: new Date() } });
    return { ok: true };
  });

  app.get("/admin/audit", { preHandler: requirePermission("audit.view") }, async () =>
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { actor: { select: { name: true, collegeRoll: true } } } }),
  );
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../lib/db.ts";
import { requireAuth } from "../lib/auth.ts";
import { can } from "../lib/permissions.ts";
import { projectStudent, visibleFieldMatch } from "../lib/privacy.ts";
import { Prisma, type Student } from "../generated/prisma/client.ts";

const PAGE_SIZE = 30;

export async function studentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/fields", async () => db.fieldDefinition.findMany({ orderBy: { order: "asc" } }));

  /**
   * Directory. Query: q (name or roll), joined=yes|no, page, and one param per
   * filterable field: ?university=DU,BUET&bloodGroup=O%2B
   */
  app.get("/students", async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const { q, joined, page } = z
      .object({
        q: z.string().trim().max(80).optional(),
        joined: z.enum(["yes", "no"]).optional(),
        page: z.coerce.number().int().min(1).max(1000).default(1),
      })
      .parse(query);

    const viewer = req.user!;
    const isAdmin = can(viewer.roles, "students.view_private");
    const fields = await db.fieldDefinition.findMany({ orderBy: { order: "asc" } });

    const where: Prisma.Sql[] = [Prisma.sql`status IN ('unclaimed','active')`];
    if (!isAdmin) where.push(Prisma.sql`("hiddenFromDirectory" = false OR id = ${viewer.id})`);
    if (joined === "yes") where.push(Prisma.sql`status = 'active'`);
    if (joined === "no") where.push(Prisma.sql`status = 'unclaimed'`);
    if (q) {
      where.push(
        /^\d+$/.test(q)
          ? Prisma.sql`"collegeRoll" LIKE ${"%" + q}`
          : Prisma.sql`name ILIKE ${"%" + q + "%"}`,
      );
    }
    const applied: Record<string, string[]> = {};
    for (const f of fields.filter((f) => f.isFilterable)) {
      const raw = query[f.key];
      if (!raw) continue;
      const values = raw.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 20);
      if (!values.length) continue;
      applied[f.key] = values;
      where.push(visibleFieldMatch(f, values, isAdmin));
    }

    const cond = Prisma.join(where, " AND ");
    const [rows, [{ total }]] = await Promise.all([
      db.$queryRaw<Student[]>`
        SELECT * FROM "Student" WHERE ${cond}
        ORDER BY (status = 'active') DESC, name ASC
        LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
      db.$queryRaw<[{ total: number }]>`SELECT count(*)::int AS total FROM "Student" WHERE ${cond}`,
    ]);
    return {
      total,
      page,
      pageSize: PAGE_SIZE,
      applied,
      items: rows.map((s) => projectStudent(viewer, s, fields)),
    };
  });

  /** Options + counts for each filterable field (only from values visible to the viewer). */
  app.get("/students/filters", async (req) => {
    const isAdmin = can(req.user!.roles, "students.view_private");
    const visibleTo = isAdmin ? ["members", "admins"] : ["members"];
    const fields = await db.fieldDefinition.findMany({ where: { isFilterable: true }, orderBy: { order: "asc" } });
    return Promise.all(
      fields.map(async (f) => {
        const visibility = f.visibilityLocked
          ? Prisma.sql`${f.defaultVisibility}::text`
          : Prisma.sql`COALESCE(privacy->>${f.key}, ${f.defaultVisibility}::text)`;
        const valueExpr =
          f.type === "tags" || f.type === "multiselect"
            ? Prisma.sql`jsonb_array_elements_text(CASE WHEN jsonb_typeof(data->${f.key}) = 'array' THEN data->${f.key} ELSE '[]'::jsonb END)`
            : Prisma.sql`data->>${f.key}`;
        const options =
          f.filterUi === "search"
            ? []
            : await db.$queryRaw<{ value: string; count: number }[]>`
                SELECT v AS value, count(*)::int AS count FROM (
                  SELECT ${valueExpr} AS v FROM "Student"
                  WHERE status IN ('unclaimed','active') AND ${visibility} = ANY(${visibleTo})
                ) s WHERE v IS NOT NULL AND v <> ''
                GROUP BY v ORDER BY count DESC, v ASC LIMIT 60`;
        return { key: f.key, labelEn: f.labelEn, labelBn: f.labelBn, type: f.type, ui: f.filterUi, options };
      }),
    );
  });

  app.get("/students/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const [s, fields] = await Promise.all([
      db.student.findUnique({ where: { id } }),
      db.fieldDefinition.findMany({ orderBy: { order: "asc" } }),
    ]);
    const isAdmin = can(req.user!.roles, "students.view_private");
    if (!s || (s.hiddenFromDirectory && s.id !== req.user!.id && !isAdmin)) {
      return reply.code(404).send({ error: "not_found" });
    }
    return projectStudent(req.user!, s, fields);
  });

  /** Logs a "help them join" share so we can show "invited by N batchmates". */
  app.post("/students/:id/invite", async (req, reply) => {
    const { id } = z.object({ id: z.string().max(40) }).parse(req.params);
    const { channel } = z.object({ channel: z.enum(["whatsapp", "messenger", "sms", "copy"]) }).parse(req.body);
    const s = await db.student.findUnique({ where: { id }, select: { status: true } });
    if (!s || s.status !== "unclaimed") return reply.code(400).send({ error: "already_joined" });
    await db.invite.create({ data: { inviterId: req.user!.id, inviteeId: id, channel } });
    return { invitedBy: await db.invite.count({ where: { inviteeId: id } }) };
  });

  app.get("/stats", async () => {
    const [total, joined, activeToday] = await Promise.all([
      db.student.count({ where: { status: { in: ["unclaimed", "active"] } } }),
      db.student.count({ where: { status: "active" } }),
      db.student.count({ where: { lastSeenAt: { gte: new Date(Date.now() - 864e5) } } }),
    ]);
    return { total, joined, activeToday };
  });
}

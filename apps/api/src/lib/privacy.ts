import type { FieldDefinition, Student, Visibility } from "../generated/prisma/client.ts";
import { Prisma } from "../generated/prisma/client.ts";
import type { AuthUser } from "./auth.ts";
import { can } from "./permissions.ts";

type Viewer = AuthUser;

export function visibilityOf(student: Pick<Student, "privacy">, field: FieldDefinition): Visibility {
  if (field.visibilityLocked) return field.defaultVisibility;
  const override = (student.privacy as Record<string, Visibility>)[field.key];
  return override ?? field.defaultVisibility;
}

function canSee(viewer: Viewer, student: Pick<Student, "id" | "privacy">, field: FieldDefinition) {
  if (viewer.id === student.id) return true;
  const v = visibilityOf(student, field);
  if (v === "members") return true;
  if (v === "admins") return can(viewer.roles, "students.view_private");
  return false;
}

/**
 * The only way student records leave the API. Never includes password, SSC or
 * claim hashes; `data` keeps only the fields this viewer is allowed to see.
 */
export function projectStudent(viewer: Viewer, s: Student, fields: FieldDefinition[]) {
  const data = s.data as Record<string, unknown>;
  const visible: Record<string, unknown> = {};
  for (const f of fields) {
    if (data[f.key] !== undefined && data[f.key] !== "" && canSee(viewer, s, f)) visible[f.key] = data[f.key];
  }
  const isSelf = viewer.id === s.id;
  return {
    id: s.id,
    collegeRoll: s.collegeRoll,
    name: s.name,
    photoUrl: s.photoUrl,
    status: s.status,
    joined: s.status === "active",
    lastSeenAt: s.showOnline || isSelf ? s.lastSeenAt : null,
    data: visible,
    ...(isSelf && {
      privacy: s.privacy,
      hiddenFromDirectory: s.hiddenFromDirectory,
      showOnline: s.showOnline,
      roles: s.roles,
    }),
  };
}

/**
 * SQL condition: `field` holds `value` AND is visible to members.
 * Used for directory filters so that filtering can't reveal hidden values.
 * `field.key` comes from FieldDefinition (whitelisted), values are parameters.
 */
export function visibleFieldMatch(field: FieldDefinition, values: string[], viewerIsAdmin: boolean) {
  const key = field.key;
  const visibleTo = viewerIsAdmin ? ["members", "admins"] : ["members"];
  const visibility = field.visibilityLocked
    ? Prisma.sql`${field.defaultVisibility}::text`
    : Prisma.sql`COALESCE(privacy->>${key}, ${field.defaultVisibility}::text)`;
  const match =
    field.type === "tags" || field.type === "multiselect"
      ? Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(data->${key}) = 'array' THEN data->${key} ELSE '[]'::jsonb END) t(v) WHERE lower(t.v) = ANY(${values.map((v) => v.toLowerCase())}))`
      : field.filterUi === "search"
        ? Prisma.sql`(data->>${key}) ILIKE ${"%" + values[0] + "%"}`
        : Prisma.sql`lower(data->>${key}) = ANY(${values.map((v) => v.toLowerCase())})`;
  return Prisma.sql`(${visibility} = ANY(${visibleTo}) AND ${match})`;
}

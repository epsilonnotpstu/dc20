import type { Role } from "../generated/prisma/client.ts";

export type Permission =
  | "students.view_private"
  | "students.edit"
  | "students.issue_claim_code"
  | "fields.manage"
  | "roles.manage"
  | "chat.moderate"
  | "events.manage"
  | "content.manage"
  | "reports.review"
  | "audit.view";

const ALL: Permission[] = [
  "students.view_private",
  "students.edit",
  "students.issue_claim_code",
  "fields.manage",
  "roles.manage",
  "chat.moderate",
  "events.manage",
  "content.manage",
  "reports.review",
  "audit.view",
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: ALL,
  admin: ALL.filter((p) => p !== "roles.manage"),
  moderator: ["chat.moderate", "content.manage", "reports.review"],
  event_manager: ["events.manage"],
  content_manager: ["content.manage"],
};

export function can(roles: Role[], perm: Permission) {
  return roles.some((r) => ROLE_PERMISSIONS[r].includes(perm));
}

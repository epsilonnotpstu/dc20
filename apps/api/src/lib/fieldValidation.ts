import { z } from "zod";
import type { FieldDefinition } from "../generated/prisma/client.ts";

const text = (max: number) => z.string().trim().max(max);

function schemaFor(f: FieldDefinition): z.ZodType {
  switch (f.type) {
    case "textarea":
      return text(2000);
    case "number":
      return z.coerce.number().finite();
    case "date":
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
    case "phone":
      return z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, "invalid phone");
    case "email":
      return z.string().trim().toLowerCase().email().max(200);
    case "url":
      return z.string().trim().url().max(300).refine((u) => /^https?:\/\//.test(u), "must start with http(s)://");
    case "select":
      return f.options.length ? z.enum(f.options as [string, ...string[]]) : text(100);
    case "multiselect":
      return z.array(f.options.length ? z.enum(f.options as [string, ...string[]]) : text(60)).max(20);
    case "tags":
      return z.array(text(40).min(1)).max(12).transform((a) => [...new Set(a)]);
    default:
      return text(200);
  }
}

/**
 * Validates a partial profile update. `null` or "" clears a field.
 * Returns the cleaned values or a map of field errors.
 */
export function validateProfileData(
  input: Record<string, unknown>,
  fields: FieldDefinition[],
  opts: { asAdmin: boolean },
) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const clean: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const field = byKey.get(key);
    if (!field) {
      errors[key] = "unknown field";
      continue;
    }
    if (!field.isEditableByUser && !opts.asAdmin) {
      errors[key] = "not editable";
      continue;
    }
    if (value === null || value === "") {
      clean[key] = null;
      continue;
    }
    const parsed = schemaFor(field).safeParse(value);
    if (parsed.success) clean[key] = parsed.data;
    else errors[key] = parsed.error.issues[0]?.message ?? "invalid";
  }
  return { clean, errors };
}

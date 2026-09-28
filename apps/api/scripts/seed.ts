/**
 * One-time import of the college sheet + photos.
 *
 *   pnpm seed -- --xlsx /path/students.xlsx --photos /path/photos [--dry-run]
 *
 * - Rows without a name are skipped (empty roll numbers).
 * - SSC reg numbers are stored only as argon2 hashes; HSC reg is not stored.
 * - Re-running is safe: existing unclaimed students are updated, claimed ones are left alone.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import ExcelJS from "exceljs";
import argon2 from "argon2";
import { db } from "../src/lib/db.ts";
import { DEFAULT_FIELDS, SHEET_COLUMNS } from "../src/lib/fields.ts";
import { saveAvatar } from "../src/lib/storage.ts";

const { values: args } = parseArgs({
  options: {
    xlsx: { type: "string", default: process.env.SEED_XLSX },
    photos: { type: "string", default: process.env.SEED_PHOTOS_DIR },
    "dry-run": { type: "boolean", default: false },
  },
});
if (!args.xlsx || !args.photos) {
  console.error("usage: pnpm seed -- --xlsx <file> --photos <dir> [--dry-run]");
  process.exit(1);
}
const dryRun = args["dry-run"];

const cellText = (v: ExcelJS.CellValue) => {
  if (v == null) return "";
  if (typeof v === "object" && "text" in v) return String(v.text).trim();
  if (typeof v === "object" && "result" in v) return String(v.result ?? "").trim();
  return String(v).trim();
};

const normalize: Record<string, (v: string) => string> = {
  group: (v) => v.replace(/^HSC\s*-\s*/i, ""),
};

async function ensureFields() {
  if ((await db.fieldDefinition.count()) > 0) return;
  await db.fieldDefinition.createMany({
    data: DEFAULT_FIELDS.map((f, i) => ({ ...f, order: i * 10 }) as never),
  });
  console.log(`created ${DEFAULT_FIELDS.length} field definitions`);
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

async function main() {
  // The streaming reader skips the embedded photo drawings, which the regular reader chokes on.
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(args.xlsx!, {
    worksheets: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
  });

  type Row = { roll: string; name: string; ssc: string; data: Record<string, string> };
  const rows: Row[] = [];
  for await (const ws of reader) {
    let headers: string[] = [];
    const col = (name: string) => headers.indexOf(name);
    for await (const row of ws) {
      const v = row.values as ExcelJS.CellValue[];
      if (row.number === 1) {
        headers = v.map(cellText);
        continue;
      }
      const name = cellText(v[col("Student Name")]);
      const roll = cellText(v[col("Roll")]);
      if (!name || !roll) continue;
      const data: Record<string, string> = {};
      for (const [header, key] of Object.entries(SHEET_COLUMNS)) {
        const raw = cellText(v[col(header)]);
        if (raw && raw !== "None") data[key] = normalize[key]?.(raw) ?? raw;
      }
      rows.push({ roll, name, ssc: cellText(v[col("SSC Reg No")]), data });
    }
    break; // first sheet only
  }

  const report = { rows: rows.length, created: 0, updated: 0, skippedClaimed: 0, missingPhoto: [] as string[], missingSsc: [] as string[] };
  console.log(`${rows.length} students with data${dryRun ? " (dry run)" : ""}`);
  if (!dryRun) await ensureFields();

  let done = 0;
  await pool(rows, 4, async (r) => {
    const photoPath = join(args.photos!, `${r.roll}.jpg`);
    if (!existsSync(photoPath)) report.missingPhoto.push(r.roll);
    if (!/^\d{6,}$/.test(r.ssc)) report.missingSsc.push(r.roll);
    if (dryRun) return;

    const existing = await db.student.findUnique({ where: { collegeRoll: r.roll } });
    if (existing && existing.status !== "unclaimed") {
      report.skippedClaimed++;
      return;
    }
    const photoUrl = existsSync(photoPath) ? await saveAvatar(await readFile(photoPath)) : null;
    const sscRegHash = /^\d{6,}$/.test(r.ssc) ? await argon2.hash(r.ssc) : null;
    const fields = { name: r.name, data: r.data, sscRegHash, ...(photoUrl && { photoUrl }) };
    if (existing) {
      await db.student.update({ where: { id: existing.id }, data: fields });
      report.updated++;
    } else {
      await db.student.create({ data: { collegeRoll: r.roll, ...fields } });
      report.created++;
    }
    if (++done % 100 === 0) console.log(`  ${done}/${rows.length}`);
  });

  await writeFile("seed-report.json", JSON.stringify(report, null, 2));
  console.log(
    `created ${report.created}, updated ${report.updated}, skipped (already claimed) ${report.skippedClaimed}, ` +
      `missing photo ${report.missingPhoto.length}, missing SSC reg ${report.missingSsc.length} → seed-report.json`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());

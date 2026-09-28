import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { env } from "./env.ts";

/**
 * Local-disk media store served at /media. Keys are random so URLs cannot be
 * enumerated. Swap this module for an S3/R2 client in production — callers
 * only use `saveAvatar` and get back a URL path.
 */
const root = resolve(env.UPLOAD_DIR);

async function put(key: string, body: Buffer) {
  const path = join(root, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  return `/media/${key}`;
}

/** Stores a 640px and a 160px WebP; metadata (EXIF/GPS) is stripped by sharp. */
export async function saveAvatar(input: Buffer) {
  const id = randomBytes(12).toString("base64url");
  const base = sharp(input).rotate();
  const [full, small] = await Promise.all([
    base.clone().resize(640, 640, { fit: "cover" }).webp({ quality: 82 }).toBuffer(),
    base.clone().resize(160, 160, { fit: "cover" }).webp({ quality: 78 }).toBuffer(),
  ]);
  await put(`avatars/${id}-sm.webp`, small);
  return put(`avatars/${id}.webp`, full);
}

export const mediaRoot = root;

import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  UPLOAD_DIR: z.string().default("./uploads"),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === "production";

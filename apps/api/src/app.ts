import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { env } from "./lib/env.ts";
import { mediaRoot } from "./lib/storage.ts";
import { authRoutes } from "./routes/auth.ts";
import { meRoutes } from "./routes/me.ts";
import { studentRoutes } from "./routes/students.ts";
import { adminRoutes } from "./routes/admin.ts";

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true });

  await app.register(cors, { origin: env.WEB_ORIGIN.split(","), credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart);
  await app.register(fastifyStatic, {
    root: mediaRoot,
    prefix: "/media/",
    maxAge: "30d",
    immutable: true,
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "validation", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    if ((err as { statusCode?: number }).statusCode === 429) return reply.code(429).send({ error: "rate_limited" });
    req.log.error(err);
    return reply.code(500).send({ error: "server_error" });
  });

  app.get("/health", async () => ({ ok: true }));
  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(studentRoutes);
  await app.register(adminRoutes);
  return app;
}

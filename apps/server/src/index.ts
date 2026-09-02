import { Hono } from "hono";
import { JEREMYCODE_NAME } from "@bun-hono-opentui/shared";

const app = new Hono()
  .get("/", (c) => c.json({ message: `Welcome to ${JEREMYCODE_NAME}` }))
  .get("/health", (c) => c.json({ status: "ok" }));

export type AppType = typeof app;

const port = Number(Bun.env.PORT ?? 3000);

console.log(`Hono server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};

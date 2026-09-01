import { Hono } from "hono";
import { JEREMYCODE_NAME } from "@bun-hono-opentui/shared";

const app = new Hono();

app.get("/", (c) =>
  c.json({
    message: `Welcome to ${JEREMYCODE_NAME}`,
  }),
);

app.get("/health", (c) => c.json({ status: "ok" }));

const port = Number(Bun.env.PORT ?? 3000);

console.log(`Hono server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};

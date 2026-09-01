import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) =>
  c.json({
    message: "Welcome to the Bun + Hono server",
  }),
);

app.get("/health", (c) => c.json({ status: "ok" }));

const port = Number(Bun.env.PORT ?? 3000);

console.log(`Hono server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};

import { Hono } from "hono";
import { JEREMYCODE_NAME } from "@bun-hono-opentui/shared";

export const app = new Hono()
  .get("/", (c) => c.json({ message: `Welcome to ${JEREMYCODE_NAME}` }))
  .get("/health", (c) => c.json({ status: "ok" }));

export type AppType = typeof app;

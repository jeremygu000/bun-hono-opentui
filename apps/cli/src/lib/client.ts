import { hc } from "hono/client";
import type { AppType } from "@bun-hono-opentui/server/app";

export const api = hc<AppType>(Bun.env.API_URL ?? "http://localhost:3000");

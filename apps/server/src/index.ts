import { app } from "./app";

export type { AppType } from "./app";
export { app } from "./app";

const port = Number(Bun.env.PORT ?? 3000);

console.log(`Hono server listening on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};

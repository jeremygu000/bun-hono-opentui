import { app } from "./app";

export type { AppType } from "./app";
export { app } from "./app";

const port = Number(Bun.env.PORT ?? 3000);

console.log(`Hono server listening on http://localhost:${port}`);

// Stream endpoints push text without waiting for client reads, so the
// default 10s idle timeout would cut off long generations (e.g. the
// 100-sentence LLM test). 0 disables the idle timer entirely; short
// non-streaming endpoints are unaffected.
export default {
  port,
  idleTimeout: 0,
  fetch: app.fetch,
};

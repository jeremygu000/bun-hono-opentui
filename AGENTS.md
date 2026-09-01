# Repository Guide

## Workspace Layout

- `apps/server` is the Bun/Hono HTTP server; its entrypoint is `apps/server/src/index.ts` and its health endpoint is `GET /health`.
- `apps/cli` is the OpenTUI React CLI; its entrypoint is `apps/cli/src/index.tsx`.
- Put future reusable libraries in `packages/*`; the root workspace globs are `apps/*` and `packages/*`.
- Package `tsconfig.json` files extend `tsconfig.base.json`; keep framework-specific options, such as OpenTUI JSX settings, in the owning app config.

## Commands

- Install dependencies only from the repository root: `bun install`.
- Run the server: `bun run dev:server`; run the CLI: `bun run dev:cli`.
- Run all current automated verification: `bun run typecheck`.
- For server changes, additionally start it and check `http://localhost:3000/health`.

## Constraints

- Use Bun for package installation and scripts. Keep the single root `bun.lock` committed; do not add npm, pnpm, or Yarn lockfiles.
- `node_modules/` is ignored but required locally for Bun workspace dependency and editor type resolution. Restore it with `bun install`, rather than committing it.
- In OpenTUI, never use `process.exit()` to leave the UI. Call `renderer.destroy()` so alternate-screen and raw-input terminal state are restored.

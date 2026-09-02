# Repository Guide

## File Naming and Structure Conventions

- Filenames use `kebab-case.ts` / `kebab-case.tsx` (e.g. `prompt-textarea.tsx`). Export the matching PascalCase symbol (e.g. `PromptTextarea`).
- Within an app or package, group code by role:
  - `src/index.{ts,tsx}` is the entrypoint and stays minimal (renderer setup, root render).
  - `src/components/` holds reusable, presentational pieces (each component in its own file).
  - `src/screens/` holds page-level compositions that wire components, state, and side effects.
  - `src/lib/` (or similar) holds framework-agnostic helpers when needed.
- Add new reusable libraries under `packages/<name>/` with a workspace `package.json` and its own `tsconfig.json` extending the base.

## Commands

- Install dependencies only from the repository root: `bun install`.
- Run the server: `bun run dev:server`; run the CLI: `bun run dev:cli`.
- Run all current automated verification: `bun run typecheck`.
- For server changes, additionally start it and check `http://localhost:3000/health`.

## Workspace Package Layout

- Each workspace package's `package.json` uses the conditional exports
  map: `"exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } }`.
  Do not use the string shorthand or array form.
- The server keeps Hono routes and the `AppType` type in
  `apps/server/src/app.ts` and exposes them under the `./app` subpath.
  The root `./` entry is the Bun bootstrap (port, logging, fetch).
- The CLI's typed RPC client (`apps/cli/src/lib/client.ts`) imports
  `AppType` from `@bun-hono-opentui/server/app` and constructs
  `hc<AppType>(API_URL)`. The `./app` subpath plus `import type` keep
  the server bootstrap out of the CLI bundle.
- `@bun-hono-opentui/server` is a `devDependency` of `@bun-hono-opentui/cli`,
  not a runtime dependency.

## Constraints

- Use Bun for package installation and scripts. Keep the single root `bun.lock` committed; do not add npm, pnpm, or Yarn lockfiles.
- `node_modules/` is ignored but required locally for Bun workspace dependency and editor type resolution. Restore it with `bun install`, rather than committing it.
- In OpenTUI, never use `process.exit()` to leave the UI. Call `renderer.destroy()` so alternate-screen and raw-input terminal state are restored.

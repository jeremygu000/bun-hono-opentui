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

## Constraints

- Use Bun for package installation and scripts. Keep the single root `bun.lock` committed; do not add npm, pnpm, or Yarn lockfiles.
- `node_modules/` is ignored but required locally for Bun workspace dependency and editor type resolution. Restore it with `bun install`, rather than committing it.
- In OpenTUI, never use `process.exit()` to leave the UI. Call `renderer.destroy()` so alternate-screen and raw-input terminal state are restored.

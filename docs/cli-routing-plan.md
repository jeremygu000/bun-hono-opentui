# Plan: Routing in `apps/cli`

## Goal

Add lightweight, browser-free routing to the OpenTUI CLI so future screens
(for example, sessions, settings, command palette) can be reached by name
without each one re-implementing mount/unmount logic. The routing layer must:

- Stay framework-agnostic inside `apps/cli` (use the existing OpenTUI React
  reconciler unchanged).
- Be industry-standard so contributors recognise the pattern immediately.
- Add no new runtime dependencies beyond React Router itself.

## Library choice

Use **React Router v7 in data mode**, specifically `createMemoryRouter` plus
`<RouterProvider>`. Rationale:

- React Router is the de-facto standard for React routing; the data API is
  the current recommended surface and matches what most tutorials and docs
  describe today.
- `createMemoryRouter` keeps navigation in JS memory. There is no real URL,
  no browser history API, and no server loader context — which fits a TUI
  where the "URL" is just an in-app screen name.
- The data API gives us loaders/actions, nested routes, and `<Outlet />` for
  nested layouts, all of which scale as the CLI grows.
- We avoid the "framework" mode (`@react-router/dev`, `@react-router/node`,
  `@react-router/serve`, Vite plugin) entirely. That mode is designed for
  full-stack web apps and would force a build step we do not need.

Bundle size is acceptable: `react-router` is a single ESM dependency and is
already tree-shakeable through Bun's bundler.

## Target file layout

```
apps/cli/src/
├── index.tsx                     # entrypoint: create renderer + router, render <RouterProvider/>
├── router.tsx                    # createAppRouter(): builds the route tree, exports the router
├── routes.tsx                    # ROUTES: name -> path constants (single source of truth)
├── routes/                       # one file per screen
│   ├── home.tsx                  # HomeScreen (refactor of current screens/home-screen.tsx)
│   ├── not-found.tsx             # NotFoundScreen for unmatched paths
│   └── (future screens here)
├── components/                   # presentational pieces (unchanged)
│   ├── logo-art.tsx
│   └── prompt-textarea.tsx
└── screens/                      # screen-level compositions; can wrap route components when needed
    └── home-screen.tsx
```

Why split `routes.tsx` from `router.tsx`:

- `routes.tsx` exports a typed map of route names to paths so screens can
  navigate without stringly-typed literals: `routes.home`, `routes.settings`.
- `router.tsx` is the only place that wires paths to route components. Moving
  a screen only touches `router.tsx` and the new file under `routes/`.

## Routing conventions

- Path style: flat, kebab-case, resource-oriented (`/`, `/sessions`,
  `/sessions/:id`, `/settings`). No deep nesting beyond one level unless a
  layout genuinely needs it.
- Each screen is its own file under `routes/` exporting a default React
  component. Keep them thin; compose existing `components/` and
  `screens/` pieces inside.
- Layouts (e.g. a persistent footer or sidebar) go in `routes/_layout.tsx`
  with an `<Outlet />` for nested children.
- Loading and error UI: rely on React Router's `HydrateFallback` and
  `ErrorBoundary` route properties. No app-level Suspense unless we add
  async loaders.
- Navigation: use the `useNavigate()` hook for in-screen transitions and
  `<Link>` / `<NavLink>` when rendering clickable labels.
- 404 handling: a `notFound` route with `path: "*"` renders a tiny
  `NotFoundScreen`.

## Programmatic navigation pattern

Add a single helper:

```ts
// apps/cli/src/lib/navigation.ts
import { useNavigate } from "react-router";
import { routes } from "../routes";

export function useAppNavigate() {
  const navigate = useNavigate();
  return {
    goHome: () => navigate(routes.home),
    goTo: (path: string) => navigate(path),
  };
}
```

Screens import `useAppNavigate` instead of `useNavigate` directly, so the
"where can I go" surface stays in one file.

## Keyboard integration

The current `q`-to-quit behaviour lives in the root screen. After the
refactor:

- Global keys (quit, command palette) live in the root layout component so
  they work on every route.
- Screen-specific keys stay inside that screen's component.
- Keep using `useKeyboard` from `@opentui/react`; React Router does not own
  input.

## Implementation steps

1. Add the dependency at the workspace root by editing
   `apps/cli/package.json`:

   ```jsonc
   "dependencies": {
     "react-router": "^7.0.0"
   }
   ```

   then `bun install` from the repo root. Do not introduce a second
   lockfile.

2. Create `apps/cli/src/routes.tsx` with the route name -> path map.

3. Create `apps/cli/src/router.tsx` exporting `createAppRouter()` that
   returns a `createMemoryRouter(...)` instance. The tree starts with:

   ```tsx
   createMemoryRouter([
     { path: routes.home, element: <HomeScreen /> },
     { path: "*", element: <NotFoundScreen /> },
   ]);
   ```

4. Refactor the current `screens/home-screen.tsx` into
   `routes/home.tsx`. Keep the same component body; just change the file
   location and update its imports.

5. Add a minimal `routes/not-found.tsx`.

6. Update `apps/cli/src/index.tsx` to:

   ```tsx
   import { RouterProvider } from "react-router/dom";
   import { createAppRouter } from "./router";

   const renderer = await createCliRenderer({ exitOnCtrlC: true });
   const router = createAppRouter();
   createRoot(renderer).render(<RouterProvider router={router} />);
   ```

   Note: `RouterProvider` is the React-DOM entry. OpenTUI's React renderer
   re-exports the same React reconciler; importing from `react-router/dom`
   keeps parity with documented usage.

7. Run `bun run typecheck`. The CLI tsconfig already extends the base; no
   changes needed.

8. Manual smoke test: `bun run dev:cli`. Confirm the home screen still
   renders, `q` still exits cleanly through `renderer.destroy()`, and
   navigating to an unknown route (programmatically) shows the not-found
   screen.

## What we explicitly do not do

- No `@react-router/dev`, no Vite plugin, no SSR.
- No nested layouts beyond the first refactor. Add them only when a real
  second screen needs shared chrome.
- No URL parsing, no deep linking, no persisted history. `memory` history
  is the right primitive for a TUI.
- No new global state library. React Router loaders + component state are
  enough for the foreseeable surface.

## Acceptance criteria

- `bun run typecheck` passes from the repo root.
- `bun run dev:cli` boots into the home screen.
- Adding a new screen is a 3-file change: new `routes/<name>.tsx`, one line
  in `router.tsx`, one entry in `routes.tsx`.
- Quit semantics (`renderer.destroy()` on `q`) survive the refactor.

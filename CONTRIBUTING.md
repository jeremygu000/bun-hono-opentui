# Contributing

Thanks for contributing to this project.

## Prerequisites

- Bun 1.3 or later
- Git

## Development Setup

1. Fork the repository and clone your fork.
2. Install all workspace dependencies from the repository root:

   ```sh
   bun install
   ```

3. Start the package you are changing:

   ```sh
   bun run dev:server
   bun run dev:cli
   ```

## Making Changes

- Keep changes focused and avoid unrelated formatting or refactors.
- Place server code in `server/src` and CLI code in `cli/src`.
- Put shared TypeScript options in `tsconfig.base.json`; keep package-specific options in the package `tsconfig.json`.
- Use Bun for installing packages and running scripts. Do not add another package manager lockfile.

## Verification

Run the complete type check before opening a pull request:

```sh
bun run typecheck
```

For server changes, also start the server and request `GET /health`.

## Pull Requests

- Describe what changed and why.
- Include verification results in the pull request description.
- Keep each pull request limited to one logical change.
- Update the README when commands, package layout, or behavior changes.

## Code of Conduct

Be respectful, constructive, and inclusive in all project interactions.

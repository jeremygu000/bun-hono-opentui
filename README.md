# Bun Hono OpenTUI Monorepo

A minimal Bun workspace monorepo with a Hono server and an OpenTUI CLI.

## Requirements

- [Bun](https://bun.sh) 1.3 or later

## Packages

| Package | Description |
| --- | --- |
| [`server`](./server) | Lightweight Hono HTTP server running on Bun. |
| [`cli`](./cli) | OpenTUI welcome screen running in the terminal. |

## Getting Started

Install all workspace dependencies from the repository root:

```sh
bun install
```

Start the Hono development server at <http://localhost:3000>:

```sh
bun run dev:server
```

Start the OpenTUI CLI:

```sh
bun run dev:cli
```

Press `q` or `Ctrl+C` to exit the CLI. The server exposes `GET /` and `GET /health`.

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev:server` | Run the server with file watching. |
| `bun run dev:cli` | Run the CLI with file watching. |
| `bun run start:server` | Run the server once. |
| `bun run start:cli` | Run the CLI once. |
| `bun run typecheck` | Type-check every workspace package. |

## TypeScript

Shared compiler settings are defined in [`tsconfig.base.json`](./tsconfig.base.json). Each workspace package has its own `tsconfig.json` that extends this base configuration and includes only its own source files.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development workflow and contribution guidelines.

## License

This project is licensed under the [Apache License 2.0](./LICENSE).

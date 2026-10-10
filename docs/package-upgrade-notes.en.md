# Learning Notes: What Changed in This Workspace Dependency Upgrade

[中文版](./package-upgrade-notes.zh-CN.md)

This upgrade follows the unified `/chat` refactor. The goal is straightforward: update direct dependencies across the workspaces to the latest stable versions returned by this registry check, then verify that the existing code still works together.

We're upgrading dependencies, not adding a release `version` to the project or upgrading the local Bun executable. The repository still uses Bun workspaces and one root `bun.lock`.

## 1. Before and after

| Package | Previously installed | Upgraded version | Used by |
| --- | --- | --- | --- |
| `ai` | `7.0.91` | `7.0.137` | Server, CLI |
| `@ai-sdk/openai` | `4.0.56` | `4.0.91` | Server |
| `@ai-sdk/react` | `4.0.93` | `4.0.140` | CLI |
| `@opentui/core` | `0.5.10` | `0.6.0` | CLI |
| `@opentui/react` | `0.5.10` | `0.6.0` | CLI |
| `hono` | `4.13.5` | `4.13.13` | Server, CLI |
| `@hono/zod-validator` | `0.7.6` | `0.9.1` | Server |
| `zod` | `4.5.4` | `4.6.5` | Server, shared |
| `react`, `react-dom` | `19.2.8` | `19.3.0` | CLI |
| `react-router` | `8.3.1` | `8.4.0` | CLI |
| `@types/react` | `19.2.18` | `19.3.0` | CLI devDependency |
| `@types/react-dom` | `19.2.5` | `19.3.0` | CLI devDependency |
| `@types/bun` | `1.4.0` | `1.4.2` | Root devDependency |

The `typescript` declaration remains `^7.0.2`; no update was available in this check. Local `workspace:*` references also remain unchanged. They describe workspace relationships, not third-party registry packages to upgrade.

The server previously declared `ai: ^7.0.90`, but the lockfile installed `7.0.91`. The table compares installed versions. Both server and CLI now declare `^7.0.137`.

These are the results of this particular run, not a permanently current list of latest versions.

## 2. Why check every workspace?

Running `bun outdated` at the root without workspace selection showed only the root's `@types/bun` update. The AI SDK, OpenTUI, React, and other application dependencies live in app manifests.

The full check is:

```sh
bun outdated --recursive
```

It lists `Current`, `Update`, and `Latest` for each workspace. `Update` stays within the current version range; `Latest` can go beyond it.

For example, OpenTUI's `^0.5.10` allows `0.5.17`, but not `0.6.0`. Similarly, `@hono/zod-validator`'s `^0.7.6` doesn't include `0.9.1`. A minor upgrade of a `0.x` package shouldn't be treated as a guaranteed-compatible patch update.

## 3. What do package.json and bun.lock each do?

```text
root / app / shared package.json
        dependency version ranges
                    |
            root bun install
                    |
                 bun.lock
        resolved versions and graph
                    |
               node_modules
                    |
     typecheck / tests / server startup
```

We first ran `bun update --recursive --latest`, but the resulting diff updated only the root's `@types/bun`. A second outdated check still listed the app dependencies. Rather than assuming a successful command meant the entire job was done, we explicitly updated the workspace manifests to the selected versions and ran `bun install` from the root.

That gives `package.json` the new version ranges and `bun.lock` the actual resolved graph. Updating only one can leave declarations, installed packages, or future fresh installs inconsistent.

`@types/bun` previously used `latest`; Bun update wrote `^1.4.2`. The manifest now has an explicit version baseline, while the lockfile still determines the installed version.

## 4. Did the upgrade change the /chat flow?

This wasn't another API redesign. The flow remains:

```text
CLI CHAT_STRATEGY
       |
chatFetch -> typed RPC -> POST /chat
                           |
                    strategy registry
                   /        |        \
              sdk-ui   direct-text   sdk-text
```

Requests still choose exactly one of `prompt` or `messages`. `sdk-ui` remains the default strategy, and provider/model configuration remains on the server.

The working tree also retains the deprecation fix completed just before this upgrade: `onEnd` reads `finalStep.response` rather than the deprecated top-level `response`. That's the preceding fix, not a new compatibility change prompted by an upgrade failure.

The upgrade produced no type errors or failing tests that required additional application-code changes. This means the covered behavior passed; it doesn't mean every terminal interaction or provider behavior was fully verified.

## 5. Reading the verification results

We ran:

```sh
bun run typecheck
bun test apps/server/src/lib apps/cli/src/lib/chat-transport.test.ts
bun outdated --recursive
```

All workspace typechecks passed, all 11 tests passed, and the final recursive outdated check listed no outstanding updates.

The tests cover request validation, prompts/history across all strategies, direct request mapping, upstream HTTP errors, SDK in-band errors, SSE parsing, and actual CLI consumption of SSE/plain-text responses.

Error-path tests deliberately log failures such as `Provider failed` and `Provider overloaded`. Those are expected mock failures; the final `11 pass / 0 fail` result tells you whether the assertions succeeded.

We also started the upgraded server and requested `http://localhost:3000/health`. It returned `{"status":"ok"}`, and the temporary verification process was then stopped.

This run didn't call a real generation provider or perform an automated interactive OpenTUI smoke test. Health verifies startup and HTTP serving, mock tests verify the covered contracts, and typechecking verifies type compatibility. Those are different levels of evidence.

## 6. Reproducing the install and upgrading again

Install from the repository root:

```sh
bun install --frozen-lockfile
```

For the next upgrade, start with `bun outdated --recursive`, choose target versions, update manifests and the root lockfile, and run the checks above. If AI SDK APIs change, check the newly installed source, types, and docs instead of applying an older tutorial from memory.

Earlier learning notes retain their original version information. This is a new upgrade record. Short commit summaries live in the [refactor timeline](./refactor-timeline.md); the full `/chat` architecture is explained in the [strategy refactor notes](./chat-strategy-refactor.en.md).

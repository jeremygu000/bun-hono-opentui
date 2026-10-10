# 学习笔记：这次 workspace dependency upgrade 做了什么

[English version](./package-upgrade-notes.en.md)

这次是在统一 `/chat` refactor 之后升级依赖。目标很直接：把各个 workspace 的 direct dependencies 更新到本次 registry 查询返回的 latest stable version，再检查现有代码是否还能正常配合。

这里升级的是 dependency versions，不是给项目添加一个发布用的 `version`，也没有升级本机 Bun executable。仓库仍使用 Bun workspace 和唯一的 root `bun.lock`。

## 1. 升级前后版本

| Package | 升级前安装版本 | 升级后版本 | 使用位置 |
| --- | --- | --- | --- |
| `ai` | `7.0.91` | `7.0.137` | server、CLI |
| `@ai-sdk/openai` | `4.0.56` | `4.0.91` | server |
| `@ai-sdk/react` | `4.0.93` | `4.0.140` | CLI |
| `@opentui/core` | `0.5.10` | `0.6.0` | CLI |
| `@opentui/react` | `0.5.10` | `0.6.0` | CLI |
| `hono` | `4.13.5` | `4.13.13` | server、CLI |
| `@hono/zod-validator` | `0.7.6` | `0.9.1` | server |
| `zod` | `4.5.4` | `4.6.5` | server、shared |
| `react`、`react-dom` | `19.2.8` | `19.3.0` | CLI |
| `react-router` | `8.3.1` | `8.4.0` | CLI |
| `@types/react` | `19.2.18` | `19.3.0` | CLI devDependency |
| `@types/react-dom` | `19.2.5` | `19.3.0` | CLI devDependency |
| `@types/bun` | `1.4.0` | `1.4.2` | root devDependency |

`typescript` 的声明仍为 `^7.0.2`，本次没有可升级项。`workspace:*` 引用也仍然保留，它表示本地 workspace 关系，不是需要去 registry 升级的第三方 package。

server 原本声明 `ai: ^7.0.90`，但 lockfile 中实际安装的是 `7.0.91`。所以表格按实际安装版本对比；升级后的 server 和 CLI 声明统一为 `^7.0.137`。

这些版本是本次执行时的结果，不是永远有效的 latest 清单。

## 2. 为什么要检查所有 workspace

只在 root 执行不带 workspace selection 的 `bun outdated`，本次只显示了 root 的 `@types/bun`。但真正用到的 AI SDK、OpenTUI、React 等都声明在 app 的 `package.json` 里。

完整检查使用：

```sh
bun outdated --recursive
```

这会列出各 workspace 的 `Current`、`Update` 和 `Latest`。`Update` 是现有 version range 允许的版本，`Latest` 可以超出这个 range。

例如 `^0.5.10` 的 OpenTUI 可以更新到 `0.5.17`，但不会自动涵盖 `0.6.0`。`@hono/zod-validator` 的 `^0.7.6` 同样不会涵盖 `0.9.1`。对于 `0.x` package，不能把 minor upgrade 当成一定兼容的 patch upgrade。

## 3. package.json 和 bun.lock 各负责什么

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

本次先执行了 `bun update --recursive --latest`，但实际 diff 只更新了 root 的 `@types/bun`。再检查 workspace outdated 列表时，app 的依赖仍未更新。我们没有只看命令成功就认为完成，而是把各 workspace manifest 的目标版本明确更新，再从 root 执行 `bun install`。

这样 `package.json` 表达新的 version range，`bun.lock` 记录实际 resolved graph。仅修改其中一个，会让项目的声明、安装结果或后续 fresh install 不一致。

`@types/bun` 原来使用 `latest`，本次 Bun update 将它写为 `^1.4.2`。这让 manifest 有明确的 version baseline；实际安装版本仍由 lockfile 决定。

## 4. 原有 /chat 链路有没有因为升级改变

本次没有重新设计 API。仍是：

```text
CLI CHAT_STRATEGY
       |
chatFetch -> typed RPC -> POST /chat
                           |
                    strategy registry
                   /        |        \
              sdk-ui   direct-text   sdk-text
```

request 仍支持二选一的 `prompt` / `messages`；`sdk-ui` 仍为默认 strategy。provider/model 配置仍在 server。

工作区里还保留了升级前刚完成的 deprecation fix：`onEnd` 使用 `finalStep.response`，而不是 deprecated 的顶层 `response`。这是前一项修复，不是本次升级测试失败后才新增的兼容性修改。

升级后没有出现需要额外改 application code 的 type error 或 test failure。这个结果只能说明本次验证覆盖的行为通过，不能推导出所有 terminal interaction 或 provider 行为都被完整验证。

## 5. 验证结果怎么读

执行：

```sh
bun run typecheck
bun test apps/server/src/lib apps/cli/src/lib/chat-transport.test.ts
bun outdated --recursive
```

结果：全 workspace typecheck 通过；11 个 tests 通过；最后的 recursive outdated 没有输出待升级 package。

测试覆盖了 request validation、三种 strategy 的 prompt/history、direct request mapping、upstream HTTP error、SDK in-band error、SSE parser，以及 CLI 对 SSE/plain text 的实际消费。

错误测试会故意产生 `Provider failed`、`Provider overloaded` 等 log。它们是 mock failure path 的预期输出；判断结果要看最终的 `11 pass / 0 fail`。

此外，启动升级后的 server 并请求 `http://localhost:3000/health`，返回 `{"status":"ok"}`，随后关闭了这个临时验证进程。

这次没有执行真实 provider generation，也没有自动化交互式 OpenTUI smoke test。health 证明 server 可启动并处理 HTTP，mock tests 证明对应 contract，typecheck 证明类型兼容；三个层次不要混在一起理解。

## 6. 后续怎么复现安装和继续升级

从 repository root 安装：

```sh
bun install --frozen-lockfile
```

日常继续升级时，先看 `bun outdated --recursive`，明确目标版本，再更新 manifests 和 root lockfile，并运行上述 checks。AI SDK API 有变化时，优先核对新安装 package 的 source/types/docs，不能直接套旧教程。

之前的学习笔记保留当时的版本信息。这篇是新的升级记录；简要 commit 概要另见 [refactor timeline](./refactor-timeline.md)，完整 `/chat` 架构另见 [strategy refactor 笔记](./chat-strategy-refactor.zh-CN.md)。

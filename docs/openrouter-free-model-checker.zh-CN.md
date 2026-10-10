# 检查 OpenRouter 免费文本模型

[English](./openrouter-free-model-checker.en.md)

## 这个工具能告诉我们什么？

免费模型的 capacity 会变化。catalog 里有某个 model，不代表现在请求就一定成功。
`check:free-models` 获取 OpenRouter 实时 catalog，筛选标价为零的文本模型，
逐个发起很短的 streaming request，记录本轮可用性与 latency，最后输出排名和
候选模型的 server launch command。

实现位于 `apps/server/src/scripts/check-free-models.ts`，root `package.json`
提供的 script 实际执行：

```text
bun --env-file=apps/server/.env apps/server/src/scripts/check-free-models.ts
```

这是 standalone script，不是 Hono endpoint，不要求 server 已经启动，也不使用
`provider-config.ts` 或 CLI transport。它始终访问
`https://openrouter.ai/api/v1`，不会跟随普通 chat 的 `AI_PROVIDER`、
`AI_BASE_URL`、`AI_MODEL` 配置。

## 从 repository root 运行

在 `apps/server/.env` 中将 OpenRouter key 配置为 `OPENAI_API_KEY`，然后运行：

```bash
bun run check:free-models --help
bun run check:free-models --limit 5 --runs 2 --timeout 15
bun run check:free-models
bun run check:free-models --limit 5 --reasoning
```

| Option | Default | 含义 |
| --- | --- | --- |
| `--limit N` | 全部符合条件的 models | 按 ID 字母顺序取前 N 个，integer 1–1000 |
| `--runs N` | 1 | 重复测试选中的 model set，integer 1–10 |
| `--timeout seconds` | 20 | 单个 probe 的总 timeout，number 1–120 |
| `--reasoning` | off | 将 `reasoning.enabled` 从 false 改为 true |
| `--help` | — | 输出用法，不请求 catalog，也不校验 key |

未知 argument 或缺失 option value 会失败。numeric options 和 key 使用 zod 校验。
`--limit` 不是选最快的 models，只是截取按字母排序的 candidate list。
多轮测试会重新遍历 model set，而不是把同一 model 连测多次后再换下一个。

## Discovery 和 pricing 判断

```text
OPENAI_API_KEY
  -> GET /models (20-second timeout)
  -> catalogSchema.parse(unknown JSON)
  -> FreeTextModels
       prompt price == 0
       completion price == 0
       request price == 0 (missing means 0)
       input modalities include text
       output modalities are exactly [text]
  -> alphabetical sort -> optional limit
  -> sequential ProbeModel calls
  -> success-rate / first-text ranking
```

pricing string 必须非空且能转换为 finite number。paid model、negative sentinel
price 和 per-request charge 都会被排除。ID 不必以 `:free` 结尾；反过来，有这个
后缀也不能覆盖 catalog 中的非零 pricing。input 可以同时支持 text 和其他
modalities，但混合 text/audio output 会被排除。

catalog 整体经过 validation：required fields 不合法会让 discovery 失败，而不是
悄悄跳过那个 entry。工具检查 prompt、completion、request pricing，不审计所有
潜在 billing fields，也不保证未来一直免费。probe 本身会消耗 request quotas。

## 每个 probe 发什么？

`ProbeModel` 使用 raw `fetch`，不经过应用的 AI SDK strategies：

```http
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer <OPENAI_API_KEY>
Content-Type: application/json
```

```json
{
  "model": "<catalog model ID>",
  "stream": true,
  "max_tokens": 256,
  "reasoning": { "enabled": false },
  "messages": [
    { "role": "user", "content": "Reply with only READY. No explanation." }
  ]
}
```

requests 串行执行，start time 至少间隔 3.1 seconds。如果前一个 request 已耗时
超过这个间隔，下一个不再额外等待。这是 pacing，不是避免 upstream rate limit 的保证。

## Stream handling 和 timing

streaming `TextDecoder` 加 line buffer，保留跨 read 的 fragments。只解析 `data:`
lines；comment/heartbeat、role change、reasoning fields 不算 visible text。
JSON events 用 zod 校验，累积第一个 choice 的 `delta.content`。

| Result | 含义 |
| --- | --- |
| First-text time | 从 `fetch` 前计时，到首次收到包含非 whitespace text 的 content chunk |
| Total time | 到确认成功或失败为止，包含 connection/request overhead |
| Success | 有非空 text、有 completion marker，且未检测到 error 或 token-limit truncation |
| Exact reply | trim 后匹配 READY，忽略大小写，可带一个 `.`, `!`, `。`, `！` |

`[DONE]` 或非空 `finish_reason` 都算 completion marker。
`finish_reason: "length"` 会失败。reasoning-only 空输出，以及没有 completion marker
就 EOF，也会失败。有正文但不遵守 READY instruction，仍可算 success，不过会单独
记录 instruction following。HTTP 200 里出现 stream error，同样算 failure。

parser 面向 OpenAI-compatible single-line JSON events，不实现完整 multiline SSE
assembly。buffered event limit 是 1,000,000 characters。测的是 first visible text，
不是 first network byte、first reasoning token，也不是 tokens per second。
收到 finish 就结束时，total time 不一定包含最后的 `[DONE]` frame。

## Timeout 和 account-wide failure

probe timeout 覆盖整个操作，不是每次 read 单独重新计时。`Promise.race` 即使遇到
忽略 abort 的 mocked/stalled stream，也能结束等待。cleanup 会 abort request、
清除 timer，并 cancel 已取得的 reader。

普通 model failure 会继续下一个 model。HTTP 401、HTTP 402，以及 error message
匹配 `daily`、`per.day`、`credits`、`free-models-per` 的 HTTP 429，会停止整轮。
最后一条是 message heuristic，不是所有 account limit 都使用这些词。
structured HTTP error 提供展示的 message；error detail 中出现的 API key 会 redacted。

configuration/discovery 抛出 error，或没有任何 probe 成功，会设置
`process.exitCode = 1`。部分成功时正常结束，即使之后被 account limit 提前停止。
这个 standalone script 没有需要恢复的 OpenTUI renderer。

## 怎么读排名？

先按 success rate 排序，再比较 successful requests 的 median first-text time。
total duration 也只取 successful requests 的 median，failed probe latency 不纳入。
表里显示 successes / actual attempts，以及 exact READY replies 的次数。
提前停止后，未测试的 models 仍可能出现在表中，显示 `0/0` 和空 latency。

推荐 candidate 是排名中第一个有 success、并且每次 actual attempt 都 exact 的 model。
它不一定是 overall 最快的 model；early stop 时 actual attempts 也可能少于 `--runs`。
没有符合条件的结果就不打印 launch command。符合条件时打印：

```bash
AI_PROVIDER=openrouter AI_MODEL=<candidate-model-id> bun run dev:server
```

这只覆盖本次 launch 的配置。工具不会写入 `.env`、修改 provider default，或自动
切换正在运行的 server。很短的 READY response 不代表 coding quality、长回复
throughput、context capacity、tool support 或 reasoning quality。重复 probe 能帮助
观察波动，但不保证后续 availability。

## Verification

`check-free-models.test.ts` 注入 mocked `fetch`，不需要 API key 或 live OpenRouter。
五个 cases 覆盖 pricing/modality filtering、忽略 reasoning/heartbeat、HTTP-200
error event、stalled stream timeout，以及 reasoning-only empty output。

```bash
bun test apps/server/src/scripts/check-free-models.test.ts
bun run typecheck
```

这些检查验证 implementation behavior，不验证真实 models 当前是否可用。
要做实际 live check，运行 root command。

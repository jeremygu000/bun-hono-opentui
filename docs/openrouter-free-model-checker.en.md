# Checking free OpenRouter text models

[中文版](./openrouter-free-model-checker.zh-CN.md)

## What this tool tells us

Free model capacity changes. A model appearing in a catalog is not proof that a
request will succeed right now. `check:free-models` fetches the current OpenRouter
catalog, selects zero-priced text models, and makes a small streaming request to
each. It records availability and short-response latency, then prints a ranking
and a candidate server launch command.

The implementation is `apps/server/src/scripts/check-free-models.ts`; the root
`package.json` exposes it as:

```text
bun --env-file=apps/server/.env apps/server/src/scripts/check-free-models.ts
```

This is a standalone script, not a Hono endpoint. The server does not need to be
running, and the script does not use `provider-config.ts` or the CLI transport.
It always targets `https://openrouter.ai/api/v1`, regardless of `AI_PROVIDER`,
`AI_BASE_URL`, or `AI_MODEL` configured for normal chat.

## Run it from the repository root

Set your OpenRouter key as `OPENAI_API_KEY` in `apps/server/.env`, then run:

```bash
bun run check:free-models --help
bun run check:free-models --limit 5 --runs 2 --timeout 15
bun run check:free-models
bun run check:free-models --limit 5 --reasoning
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--limit N` | all eligible models | First N IDs in alphabetical order; integer 1–1000 |
| `--runs N` | 1 | Repeat the selected model set; integer 1–10 |
| `--timeout seconds` | 20 | Entire probe timeout; numeric value 1–120 |
| `--reasoning` | off | Send `reasoning.enabled: true` instead of false |
| `--help` | — | Print usage without requesting the catalog or validating the key |

Unknown arguments and missing option values fail. Numeric options and the key
are validated with zod. `--limit` does not choose the fastest models: it only
reduces the alphabetically sorted candidate list. Runs iterate the model set
again, rather than probing one model repeatedly before moving to the next.

## Discovery and pricing checks

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

Pricing strings must be nonblank, finite numeric values. Paid models, negative
sentinel prices, and per-request charges are excluded. IDs need not end in
`:free`; a misleading suffix cannot override nonzero catalog pricing. Text input
may coexist with other input modalities, but mixed text/audio output is excluded.

The catalog is validated as a whole: malformed required fields fail discovery
rather than silently skipping the affected entry. This checks catalog prompt,
completion, and request pricing; it does not audit every possible billing field
or prove future requests will stay free. Probe requests consume request quotas.

## What each probe sends

`ProbeModel` uses raw `fetch`, not the application's AI SDK strategies:

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

Request start times are at least 3.1 seconds apart, and requests are sequential.
If a request already takes longer than that, no extra spacing is needed before
the next one. This is pacing, not a guarantee against upstream rate limits.

## Stream handling and timing

A streaming `TextDecoder` and line buffer preserve chunks split across reads.
Only `data:` lines are parsed. Comments/heartbeats, role changes, and reasoning
fields do not count as visible text. JSON events are parsed with zod, and the
first choice's `delta.content` is accumulated.

| Result | Meaning |
| --- | --- |
| First-text time | From before `fetch` to the first content chunk containing non-whitespace text |
| Total time | Until success/failure is determined, including connection/request overhead |
| Success | Nonblank text, completion marker, and no detected error or token-limit truncation |
| Exact reply | Trimmed text matches `READY`, case-insensitively, with optional `.`, `!`, `。`, or `！` |

`[DONE]` or a nonempty `finish_reason` marks completion. `finish_reason: "length"`
fails the probe. Empty reasoning-only output and EOF without a completion marker
also fail. A response can succeed without following the READY instruction; that
is shown separately. An HTTP 200 carrying a stream error is still a failure.

The parser follows OpenAI-compatible single-line JSON events, not full multiline
SSE assembly. Its buffered event limit is 1,000,000 characters. It measures first
visible text, not first network byte, first reasoning token, or individual tokens
per second. Stop-on-finish timing also need not include the final `[DONE]` frame.

## Timeouts and account-wide failures

The configured probe timeout covers the entire operation, not each read.
`Promise.race` enforces it even if a mocked/stalled stream ignores abort. Cleanup
aborts the request, clears the timer, and cancels an acquired reader.

Ordinary model failures continue to the next model. HTTP 401, HTTP 402, and HTTP
429 messages matching `daily`, `per.day`, `credits`, or `free-models-per` stop the
whole run. This last check is a message heuristic; not every account limit uses
those words. Structured HTTP errors supply the displayed message. Error details
redact occurrences of the API key.

The script sets `process.exitCode = 1` if discovery/configuration throws or no
probe succeeds. Partial success returns normally, even if later account limits
stop the run. This standalone script has no OpenTUI renderer to restore.

## Reading the ranking

Models sort by success rate first, then median first-text time from successful
requests only. Total duration is also a successful-request median; failed probe
latencies are not included. Counts show successes over actual attempts, plus
the number of exact READY replies. Untested models can remain in the table after
an early stop, with `0/0` and no latency.

The suggested candidate is the first ranked model with a success and exact
replies on every actual attempt. It is not necessarily the fastest model overall,
and early stopping may leave fewer attempts than requested. If none qualifies,
no launch command is printed. A qualifying result prints:

```bash
AI_PROVIDER=openrouter AI_MODEL=<candidate-model-id> bun run dev:server
```

This changes configuration for that launch only. The tool never writes `.env`,
updates the provider default, or switches the running server automatically.
Short READY responses do not measure coding quality, long-response throughput,
context capacity, tool support, or reasoning quality. Repeating probes helps
observe variability; it does not guarantee later availability.

## Verification

`check-free-models.test.ts` uses injected `fetch` implementations and needs no
API key or live OpenRouter request. Its five cases cover price/modality filtering,
ignored reasoning and heartbeats, HTTP-200 error events, a stalled stream timeout,
and reasoning-only empty output.

```bash
bun test apps/server/src/scripts/check-free-models.test.ts
bun run typecheck
```

These checks verify implementation behavior, not the current availability of
real models. Use the root command for the actual live check.

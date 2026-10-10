import { z } from "zod";

const baseURL = "https://openrouter.ai/api/v1";
const priceSchema = z.string().refine((value) => value.trim().length > 0 && Number.isFinite(Number(value)));
const catalogSchema = z.object({ data: z.array(z.object({
  id: z.string(),
  pricing: z.object({ prompt: priceSchema, completion: priceSchema, request: priceSchema.optional() }),
  architecture: z.object({ input_modalities: z.array(z.string()), output_modalities: z.array(z.string()) }),
})) });
const errorSchema = z.object({ error: z.object({ message: z.string(), code: z.union([z.string(), z.number()]).optional() }) });
const eventSchema = z.object({
  error: z.object({ message: z.string() }).optional(),
  choices: z.array(z.object({
    delta: z.object({ content: z.string().nullable().optional() }).optional(),
    finish_reason: z.string().nullable().optional(),
  })).optional(),
});

export function FreeTextModels(input: unknown): string[] {
  return catalogSchema.parse(input).data.filter((model) =>
    Number(model.pricing.prompt) === 0 && Number(model.pricing.completion) === 0 &&
    Number(model.pricing.request ?? "0") === 0 &&
    model.architecture.input_modalities.includes("text") &&
    model.architecture.output_modalities.length === 1 && model.architecture.output_modalities[0] === "text",
  ).map((model) => model.id).sort();
}

type Sample = { model: string; firstMs: number | null; totalMs: number; ok: boolean; exact: boolean; detail: string; fatal: boolean };

export async function ProbeModel(model: string, apiKey: string, timeoutMs: number, reasoning: boolean, fetcher: typeof fetch = fetch): Promise<Sample> {
  const start = performance.now();
  const abort = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let firstMs: number | null = null;
  let text = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fatal = false;
  const work = async () => {
    const response = await fetcher(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: true, max_tokens: 256, reasoning: { enabled: reasoning },
        messages: [{ role: "user", content: "Reply with only READY. No explanation." }] }),
      signal: abort.signal,
    });
    if (!response.ok) {
      const parsed = errorSchema.safeParse(await response.json());
      const message = parsed.success ? parsed.data.error.message : response.statusText;
      fatal = response.status === 401 || response.status === 402 ||
        (response.status === 429 && /daily|per.day|credits|free-models-per/i.test(message));
      throw new Error(`HTTP ${response.status}: ${message}`);
    }
    if (!response.body) throw new Error("No response stream");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let ended = false;
    let truncated = false;
    while (true) {
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      if (buffer.length > 1_000_000) throw new Error("Oversized stream event");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      if (chunk.done && buffer) lines.push(buffer);
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") { ended = true; break; }
        const event = eventSchema.parse(JSON.parse(data));
        if (event.error) throw new Error(event.error.message);
        const choice = event.choices?.[0];
        const content = choice?.delta?.content;
        if (content) { if (content.trim()) firstMs ??= performance.now() - start; text += content; }
        if (choice?.finish_reason) { ended = true; truncated = choice.finish_reason === "length"; }
      }
      if (chunk.done || ended) break;
    }
    if (!text.trim()) throw new Error("No text returned (possibly reasoning exhausted token budget)");
    if (truncated) throw new Error("Output hit token limit");
    if (!ended) throw new Error("Stream ended without completion marker");
    return text.trim();
  };
  try {
    const reply = await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { abort.abort(); reject(new Error(`Timeout after ${timeoutMs / 1000}s`)); }, timeoutMs);
    })]);
    return { model, firstMs, totalMs: performance.now() - start, ok: true, exact: /^READY[.!。！]?$/i.test(reply), detail: reply.slice(0, 100), fatal: false };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Request failed";
    return { model, firstMs, totalMs: performance.now() - start, ok: false, exact: false, detail: detail.replaceAll(apiKey, "[redacted]"), fatal };
  } finally {
    clearTimeout(timer);
    abort.abort();
    void reader?.cancel().catch(() => undefined);
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export async function CheckFreeModels() {
  const values: Record<string, string | boolean> = {};
  const args = Bun.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "--reasoning") values[arg.slice(2)] = true;
    else if (arg === "--limit" || arg === "--runs" || arg === "--timeout") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      values[arg.slice(2)] = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (values.help) {
    console.log("bun run check:free-models [--limit 5] [--runs 2] [--timeout 20] [--reasoning]\n默认：测试所有免费文本模型，每个一次，超时20秒，关闭推理。--reasoning 开启推理。不会修改 .env。");
    return;
  }
  const options = z.object({
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    runs: z.coerce.number().int().min(1).max(10).default(1),
    timeout: z.coerce.number().min(1).max(120).default(20),
  }).parse(values);
  const apiKey = z.string().trim().min(1, "请在 apps/server/.env 设置 OPENAI_API_KEY").parse(Bun.env.OPENAI_API_KEY);
  const response = await fetch(`${baseURL}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`模型列表请求失败：HTTP ${response.status}`);
  const all = FreeTextModels(await response.json());
  const models = options.limit ? all.slice(0, options.limit) : all;
  console.log(`发现 ${all.length} 个免费文本模型，测试 ${models.length} 个 × ${options.runs} 次；超时 ${options.timeout}s；推理${values.reasoning ? "开启" : "关闭"}。`);
  console.log("首字时间只计正文，忽略心跳和推理。串行请求至少间隔3.1秒；测试会消耗免费请求额度。");
  const samples: Sample[] = [];
  let lastStart = -Infinity;
  let stopped = false;
  for (let run = 0; run < options.runs && !stopped; run++) {
    for (const model of models) {
      await Bun.sleep(Math.max(0, 3100 - (performance.now() - lastStart)));
      lastStart = performance.now();
      console.log(`[${run + 1}/${options.runs}] ${model} ...`);
      const sample = await ProbeModel(model, apiKey, options.timeout * 1000, values.reasoning === true);
      samples.push(sample);
      console.log(sample.ok ? `  成功，首字 ${(sample.firstMs! / 1000).toFixed(2)}s，总耗时 ${(sample.totalMs / 1000).toFixed(2)}s${sample.exact ? "" : "（未按要求回复 READY）"}` : `  失败：${sample.detail}`);
      if (sample.fatal) { console.log("认证、额度或账号限流问题，停止测试。"); stopped = true; break; }
    }
  }
  const summary = models.map((model) => {
    const tested = samples.filter((sample) => sample.model === model);
    const passed = tested.filter((sample) => sample.ok);
    return { model, success: passed.length, tested: tested.length,
      first: passed.length ? median(passed.map((sample) => sample.firstMs!)) : Infinity,
      total: passed.length ? median(passed.map((sample) => sample.totalMs)) : Infinity,
      exact: tested.filter((sample) => sample.exact).length,
    };
  }).sort((a, b) => (b.success / (b.tested || 1) - a.success / (a.tested || 1)) || a.first - b.first);
  console.log("\n排名（先比较成功率，再按正文首字时间排序；耗时为成功请求中位数）：");
  console.table(summary.map((row) => ({ 模型: row.model, 成功: `${row.success}/${row.tested}`, 按指令回复: row.exact,
    首字秒: Number.isFinite(row.first) ? (row.first / 1000).toFixed(2) : "—",
    总耗时秒: Number.isFinite(row.total) ? (row.total / 1000).toFixed(2) : "—",
  })));
  const best = summary.find((row) => row.success > 0 && row.exact === row.tested);
  if (best) console.log(`\n本轮最快且按指令回复的候选：${best.model}\nAI_PROVIDER=openrouter AI_MODEL=${best.model} bun run dev:server`);
  console.log("这是短回复测速，不能代表代码质量或长回复性能；免费模型负载会变化。可用 --runs 2 重测。");
  if (!samples.some((sample) => sample.ok)) process.exitCode = 1;
}

if (import.meta.main) {
  CheckFreeModels().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message.replaceAll(Bun.env.OPENAI_API_KEY ?? "__missing_key__", "[redacted]") : "检查失败");
    process.exitCode = 1;
  });
}

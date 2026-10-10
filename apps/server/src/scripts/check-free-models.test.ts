import { expect, test } from "bun:test";
import { FreeTextModels, ProbeModel } from "./check-free-models";

const model = (id: string, price: string, outputs = ["text"]) => ({
  id, pricing: { prompt: price, completion: price },
  architecture: { input_modalities: ["text"], output_modalities: outputs },
});

test("filters paid and non-text models, including per-request charges", () => {
  expect(FreeTextModels({ data: [
    model("free-model", "0"), model("paid:free", "0.1"), model("auto-priced", "-1"),
    model("image", "0", ["image"]), model("audio", "0", ["text", "audio"]),
    { ...model("request-charge", "0"), pricing: { prompt: "0", completion: "0", request: "1" } },
  ] })).toEqual(["free-model"]);
});

const mock = (body: string): typeof fetch => Object.assign(async () => new Response(body), { preconnect: fetch.preconnect });

test("ignores reasoning and heartbeat events and reads text after ignored events", async () => {
  const result = await ProbeModel("test", "secret", 1000, false, mock(
    ': heartbeat\n\ndata: {"choices":[{"delta":{"reasoning":"hidden"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"READY"}}]}\r\n\r\ndata: [DONE]',
  ));
  expect(result.ok).toBe(true);
  expect(result.exact).toBe(true);
  expect(result.firstMs).not.toBeNull();
});

test("an HTTP 200 containing an error event is not a successful model", async () => {
  const result = await ProbeModel("test", "secret", 1000, false,
    mock('data: {"error":{"message":"Overloaded"}}\n\n'));
  expect(result.ok).toBe(false);
  expect(result.detail).toBe("Overloaded");
});

test("a stalled body times out even if it ignores abort", async () => {
  const stalled: typeof fetch = Object.assign(async () => new Response(new ReadableStream()), { preconnect: fetch.preconnect });
  const result = await ProbeModel("test", "secret", 20, false, stalled);
  expect(result.ok).toBe(false);
  expect(result.firstMs).toBeNull();
  expect(result.detail).toContain("Timeout");
});

test("an empty reasoning-only completion is not successful", async () => {
  const result = await ProbeModel("test", "secret", 1000, true,
    mock('data: {"choices":[{"delta":{"reasoning":"hidden"}}]}\n\ndata: [DONE]\n\n'));
  expect(result.ok).toBe(false);
});

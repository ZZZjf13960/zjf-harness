import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_MAX_RETRIES,
  DEFAULT_MODEL_RETRY_BASE_DELAY_MS,
  DEFAULT_MODEL_TIMEOUT_MS,
  createOpenAIClient,
} from "@zjf-harness/core";

describe("model.complete timeout/retry acceptance (#31)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("exports knife defaults: 60s timeout, 2 retries, 250ms base backoff", () => {
    expect(DEFAULT_MODEL_TIMEOUT_MS).toBe(60_000);
    expect(DEFAULT_MODEL_MAX_RETRIES).toBe(2);
    expect(DEFAULT_MODEL_RETRY_BASE_DELAY_MS).toBe(250);
  });

  it("retries only 429 then succeeds (maxRetries=2)", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => "rate limited",
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "after-429", tool_calls: [] } }],
        }),
      } as Response;
    }) as typeof fetch;

    const client = createOpenAIClient(
      { OPENAI_API_KEY: "test-key" },
      { timeoutMs: 5_000, maxRetries: 2, retryBaseDelayMs: 1 },
    );
    const turn = await client.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });
    expect(turn.text).toBe("after-429");
    expect(calls).toBe(2);
  });

  it("retries only 5xx then succeeds", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 503,
          text: async () => "unavailable",
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "after-5xx", tool_calls: [] } }],
        }),
      } as Response;
    }) as typeof fetch;

    const client = createOpenAIClient(
      { OPENAI_API_KEY: "test-key" },
      { timeoutMs: 5_000, maxRetries: 2, retryBaseDelayMs: 1 },
    );
    const turn = await client.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    });
    expect(turn.text).toBe("after-5xx");
    expect(calls).toBe(2);
  });

  it("does not retry non-retryable 4xx (400/401)", async () => {
    for (const status of [400, 401]) {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return {
          ok: false,
          status,
          text: async () => "bad request",
        } as Response;
      }) as typeof fetch;

      const client = createOpenAIClient(
        { OPENAI_API_KEY: "test-key" },
        { timeoutMs: 5_000, maxRetries: 3, retryBaseDelayMs: 1 },
      );
      await expect(
        client.complete({
          messages: [{ role: "user", content: "hi" }],
          tools: [],
        }),
      ).rejects.toThrow(new RegExp(String(status)));
      expect(calls).toBe(1);
    }
  });

  it("hard timeout fires on hung fetch", async () => {
    globalThis.fetch = (async (_url, init) => {
      const signal = init?.signal;
      return await new Promise((_resolve, reject) => {
        const onAbort = () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }) as typeof fetch;

    const client = createOpenAIClient(
      { OPENAI_API_KEY: "test-key" },
      { timeoutMs: 50, maxRetries: 0, retryBaseDelayMs: 1 },
    );
    const started = Date.now();
    await expect(
      client.complete({
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      }),
    ).rejects.toThrow(/timed out after 50ms/);
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("streaming path retries 429 then delivers onDelta", async () => {
    let calls = 0;
    const chunks = [
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    globalThis.fetch = (async (_url, init) => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => "slow down",
        } as Response;
      }
      expect(JSON.parse(String(init?.body)).stream).toBe(true);
      const encoder = new TextEncoder();
      let i = 0;
      const body = new ReadableStream({
        pull(controller) {
          if (i >= chunks.length) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(chunks[i]!));
          i += 1;
        },
      });
      return { ok: true, body } as Response;
    }) as typeof fetch;

    const client = createOpenAIClient(
      { OPENAI_API_KEY: "test-key" },
      { timeoutMs: 5_000, maxRetries: 2, retryBaseDelayMs: 1 },
    );
    const deltas: string[] = [];
    const turn = await client.complete({
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      onDelta: (text) => deltas.push(text),
    });
    expect(calls).toBe(2);
    expect(deltas).toEqual(["ok"]);
    expect(turn.text).toBe("ok");
  });

  it("mid-stream timeout fails closed (no successful partial return)", async () => {
    globalThis.fetch = (async (_url, init) => {
      const signal = init?.signal;
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
            ),
          );
          const onAbort = () => {
            try {
              controller.error(
                new DOMException("The operation was aborted.", "AbortError"),
              );
            } catch {
              // ignore
            }
          };
          if (signal?.aborted) onAbort();
          else signal?.addEventListener("abort", onAbort, { once: true });
        },
      });
      return { ok: true, body } as Response;
    }) as typeof fetch;

    const client = createOpenAIClient(
      { OPENAI_API_KEY: "test-key" },
      { timeoutMs: 40, maxRetries: 0, retryBaseDelayMs: 1 },
    );
    const deltas: string[] = [];
    await expect(
      client.complete({
        messages: [{ role: "user", content: "hi" }],
        tools: [],
        onDelta: (text) => deltas.push(text),
      }),
    ).rejects.toThrow(/timed out after 40ms/);
    expect(deltas.length).toBeLessThanOrEqual(1);
  });
});

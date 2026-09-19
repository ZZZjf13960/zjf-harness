import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { Writable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSession,
  resetWorkspaceRoot,
  runLoop,
  setWorkspaceRoot,
  type LoopEvent,
  type ModelClient,
  type ModelTurn,
} from "@zjf-harness/core";
import { NativeTerminalTui } from "@zjf-harness/tui";

function fakeModel(turns: ModelTurn[]): ModelClient {
  let i = 0;
  return {
    async complete(input) {
      const turn = turns[Math.min(i, turns.length - 1)]!;
      i += 1;
      if (turn.text && input.onDelta) {
        // Emit coarse deltas so acceptance sees streaming, not just final text.
        const mid = Math.max(1, Math.floor(turn.text.length / 2));
        input.onDelta(turn.text.slice(0, mid));
        input.onDelta(turn.text.slice(mid));
      }
      return turn;
    },
  };
}

function makeTui() {
  const output = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
  const input = new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  }) as unknown as NodeJS.ReadStream;
  (input as { isTTY?: boolean }).isTTY = false;
  (input as { setRawMode?: (v: boolean) => void }).setRawMode = () => {};
  (input as { resume?: () => void }).resume = () => {};
  (input as { pause?: () => void }).pause = () => {};
  (input as { on?: (...args: unknown[]) => void }).on = () => input;
  (input as { off?: (...args: unknown[]) => void }).off = () => input;
  const ui = new NativeTerminalTui({ input, output });
  ui.open("plan");
  return ui;
}

describe("streaming acceptance (#29)", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
    resetWorkspaceRoot();
  });

  it("text-only turn emits assistant.delta then turn.done", async () => {
    const events: LoopEvent[] = [];
    const result = await runLoop({
      session: createSession({ mode: "plan" }),
      prompt: "hi",
      print: true,
      model: fakeModel([{ text: "Hello!", toolCalls: [] }]),
      onEvent: (event) => events.push(event),
    });
    expect(result.exitCode).toBe(0);
    expect(events.filter((e) => e.type === "tool.start")).toEqual([]);
    expect(events.filter((e) => e.type === "assistant.delta").length).toBeGreaterThan(0);
    expect(events.at(-1)).toEqual({ type: "turn.done" });
    const joined = events
      .filter((e): e is Extract<LoopEvent, { type: "assistant.delta" }> => e.type === "assistant.delta")
      .map((e) => e.text)
      .join("");
    expect(joined).toBe("Hello!");
  });

  it("tool turn emits delta, tool.start/end, then turn.done", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "evals-stream-"));
    setWorkspaceRoot(tmpDir);
    const file = path.join(tmpDir, "note.txt");
    await writeFile(file, "stream tool\n");
    const events: LoopEvent[] = [];
    const result = await runLoop({
      session: createSession({ mode: "plan" }),
      prompt: "read it",
      print: true,
      model: fakeModel([
        {
          text: "reading",
          toolCalls: [{ id: "read-1", name: "read", arguments: { path: file } }],
        },
        { text: "done reading", toolCalls: [] },
      ]),
      onEvent: (event) => events.push(event),
    });
    expect(result.exitCode).toBe(0);
    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "assistant.delta").length).toBeGreaterThan(0);
    const toolEvents = events.filter(
      (e) => e.type === "tool.start" || e.type === "tool.end",
    );
    expect(toolEvents).toEqual([
      { type: "tool.start", tool: "read", id: "read-1" },
      { type: "tool.end", tool: "read", id: "read-1", ok: true },
    ]);
    expect(events.at(-1)).toEqual({ type: "turn.done" });
    const firstTool = types.indexOf("tool.start");
    const firstDelta = types.indexOf("assistant.delta");
    expect(firstDelta).toBeGreaterThanOrEqual(0);
    expect(firstTool).toBeGreaterThan(firstDelta);
  });

  it("NativeTerminalTui paints stream buffer and tool progress", () => {
    const ui = makeTui();
    try {
      ui.beginStream();
      ui.appendStream("Hel");
      ui.appendStream("lo");
      expect(ui.debugState().streaming).toBe(true);
      expect(ui.debugState().streamBuffer).toBe("Hello");
      ui.setToolProgress("running read");
      expect(ui.debugState().toolProgress).toBe("running read");
      ui.endStream();
      ui.setToolProgress(undefined);
      const state = ui.debugState();
      expect(state.streaming).toBe(false);
      expect(state.streamBuffer).toBe("");
      expect(state.toolProgress).toBeUndefined();
      expect(state.messages).toContainEqual({
        role: "assistant",
        text: "Hello",
      });
    } finally {
      ui.close();
    }
  });
});

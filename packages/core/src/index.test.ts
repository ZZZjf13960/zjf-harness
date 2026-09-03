import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import {
  createSession,
  runLoop,
  type ModelClient,
  type ModelTurn,
} from "./index";

function fakeModel(turns: ModelTurn[]): ModelClient {
  let i = 0;
  return {
    async complete() {
      const turn = turns[Math.min(i, turns.length - 1)]!;
      i += 1;
      return turn;
    },
  };
}

describe("createSession", () => {
  it("defaults to plan", () => {
    expect(createSession().mode).toBe("plan");
    expect(createSession({ mode: "accept-edits" }).mode).toBe("accept-edits");
  });

  it("rejects illegal mode", () => {
    expect(() => createSession({ mode: "full-auto" })).toThrow(
      /Invalid permission mode/,
    );
  });
});

describe("runLoop", () => {
  let tmpDir: string | undefined;
  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("print+plan write is fail-closed and does not touch the file", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "core-loop-"));
    const file = path.join(tmpDir, "target.txt");
    await writeFile(file, "before\n");
    const result = await runLoop({
      session: createSession({ mode: "plan" }),
      prompt: "write it",
      print: true,
      model: fakeModel([
        {
          text: "",
          toolCalls: [
            {
              id: "1",
              name: "write",
              arguments: { path: file, content: "nope\n" },
            },
          ],
        },
      ]),
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/write/);
    expect(result.stderr).toMatch(/fail-closed/);
    expect(await readFile(file, "utf8")).toBe("before\n");
  });

  it("plan allows read; file contents are a tool result, not a permission deny", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "core-loop-"));
    const file = path.join(tmpDir, "note.txt");
    await writeFile(file, "hello core\n");
    const result = await runLoop({
      session: createSession({ mode: "plan" }),
      prompt: "read it",
      print: true,
      model: fakeModel([
        {
          text: "",
          toolCalls: [{ id: "1", name: "read", arguments: { path: file } }],
        },
        { text: "got it", toolCalls: [] },
      ]),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/mode=plan print=true/);
    expect(result.stdout).toMatch(/got it/);
    const toolMsg = result.session.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toMatch(/hello core/);
  });

  it("plan read of a missing path is a tool error, not a permission deny", async () => {
    const missing = path.join(
      os.tmpdir(),
      "zjf-core-no-such-file-please-missing.txt",
    );
    const result = await runLoop({
      session: createSession({ mode: "plan" }),
      prompt: "read missing",
      print: true,
      model: fakeModel([
        {
          text: "",
          toolCalls: [{ id: "1", name: "read", arguments: { path: missing } }],
        },
        { text: "could not read", toolCalls: [] },
      ]),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toMatch(/approval/);
    expect(result.stdout).toMatch(/could not read/);
    const toolMsg = result.session.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toMatch(/ENOENT|no such file|not found/i);
  });

  it("final text exits 0", async () => {
    const result = await runLoop({
      session: createSession(),
      prompt: "hi",
      model: fakeModel([{ text: "hello preview", toolCalls: [] }]),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/mode=plan print=false/);
    expect(result.stdout).toMatch(/hello preview/);
  });
});

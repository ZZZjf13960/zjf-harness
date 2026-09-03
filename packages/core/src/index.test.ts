import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import {
  createSession,
  runLoop,
  createOpenAIClient,
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

  it("plan allows glob; file list is a tool result, not a permission deny", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "core-glob-"));
    await writeFile(path.join(tmpDir, "fileA.txt"), "a");
    await writeFile(path.join(tmpDir, "fileB.txt"), "b");
    await writeFile(path.join(tmpDir, "fileC.md"), "c");
    const result = await runLoop({
      session: createSession({ mode: "plan" }),
      prompt: "find files",
      print: true,
      model: fakeModel([
        {
          text: "",
          toolCalls: [
            {
              id: "glob-1",
              name: "glob",
              arguments: { pattern: "*.txt", cwd: tmpDir },
            },
          ],
        },
        { text: "found files", toolCalls: [] },
      ]),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/mode=plan print=true/);
    expect(result.stdout).toMatch(/found files/);
    const toolMsg = result.session.messages.find((m) => m.role === "tool");
    expect(toolMsg?.name).toBe("glob");
    const matches = JSON.parse(toolMsg?.content ?? "[]");
    expect(matches).toEqual(["fileA.txt", "fileB.txt"]);
  });

  it("plan allows grep; matching lines are a tool result, not a permission deny", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "core-grep-"));
    const file = path.join(tmpDir, "sample.txt");
    await writeFile(file, "line 1\nneedle target\nline 3\n");
    const result = await runLoop({
      session: createSession({ mode: "plan" }),
      prompt: "search text",
      print: true,
      model: fakeModel([
        {
          text: "",
          toolCalls: [
            {
              id: "grep-1",
              name: "grep",
              arguments: { pattern: "needle", path: file },
            },
          ],
        },
        { text: "found needle", toolCalls: [] },
      ]),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/mode=plan print=true/);
    expect(result.stdout).toMatch(/found needle/);
    const toolMsg = result.session.messages.find((m) => m.role === "tool");
    expect(toolMsg?.name).toBe("grep");
    const matches = JSON.parse(toolMsg?.content ?? "[]");
    expect(matches).toEqual([`${file}:2:needle target`]);
  });

  it("print+plan edit is fail-closed and does not touch the file", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "core-edit-"));
    const file = path.join(tmpDir, "target.txt");
    await writeFile(file, "before\n");
    const result = await runLoop({
      session: createSession({ mode: "plan" }),
      prompt: "edit it",
      print: true,
      model: fakeModel([
        {
          text: "",
          toolCalls: [
            {
              id: "edit-1",
              name: "edit",
              arguments: { path: file, content: "nope\n" },
            },
          ],
        },
      ]),
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/edit/);
    expect(result.stderr).toMatch(/fail-closed/);
    expect(result.gatedTool).toBe("edit");
    expect(await readFile(file, "utf8")).toBe("before\n");
  });

  it("print+plan bash is fail-closed and does not execute the command", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "core-bash-"));
    const sideEffectFile = path.join(tmpDir, "side-effect.txt");
    const result = await runLoop({
      session: createSession({ mode: "plan" }),
      prompt: "run bash",
      print: true,
      model: fakeModel([
        {
          text: "",
          toolCalls: [
            {
              id: "bash-1",
              name: "bash",
              arguments: { command: `touch "${sideEffectFile}"` },
            },
          ],
        },
      ]),
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/bash/);
    expect(result.stderr).toMatch(/fail-closed/);
    expect(result.gatedTool).toBe("bash");
    await expect(readFile(sideEffectFile, "utf8")).rejects.toThrow();
  });

  it("accept-edits executes write and updates file on disk", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "core-accept-write-"));
    const file = path.join(tmpDir, "created.txt");
    const result = await runLoop({
      session: createSession({ mode: "accept-edits" }),
      prompt: "write file",
      print: true,
      model: fakeModel([
        {
          text: "",
          toolCalls: [
            {
              id: "write-1",
              name: "write",
              arguments: { path: file, content: "written in accept-edits\n" },
            },
          ],
        },
        { text: "written successfully", toolCalls: [] },
      ]),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/written successfully/);
    expect(await readFile(file, "utf8")).toBe("written in accept-edits\n");
    const toolMsg = result.session.messages.find((m) => m.role === "tool");
    expect(toolMsg?.name).toBe("write");
    const parsed = JSON.parse(toolMsg?.content ?? "{}");
    expect(parsed.success).toBe(true);
    expect(parsed.path).toBe(file);
  });

  it("accept-edits executes edit and updates file on disk", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "core-accept-edit-"));
    const file = path.join(tmpDir, "target.txt");
    await writeFile(file, "before edit\n");
    const result = await runLoop({
      session: createSession({ mode: "accept-edits" }),
      prompt: "edit file",
      print: true,
      model: fakeModel([
        {
          text: "",
          toolCalls: [
            {
              id: "edit-1",
              name: "edit",
              arguments: { path: file, content: "after edit\n" },
            },
          ],
        },
        { text: "edited successfully", toolCalls: [] },
      ]),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/edited successfully/);
    expect(await readFile(file, "utf8")).toBe("after edit\n");
    const toolMsg = result.session.messages.find((m) => m.role === "tool");
    expect(toolMsg?.name).toBe("edit");
    const parsed = JSON.parse(toolMsg?.content ?? "{}");
    expect(parsed.success).toBe(true);
    expect(parsed.path).toBe(file);
  });

  it("accept-edits leaves bash gated and does not execute command", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "core-accept-bash-"));
    const sideEffectFile = path.join(tmpDir, "gated.txt");
    const result = await runLoop({
      session: createSession({ mode: "accept-edits" }),
      prompt: "run bash",
      print: true,
      model: fakeModel([
        {
          text: "",
          toolCalls: [
            {
              id: "bash-1",
              name: "bash",
              arguments: { command: `touch "${sideEffectFile}"` },
            },
          ],
        },
      ]),
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Tool 'bash' requires approval in mode 'accept-edits'/);
    expect(result.gatedTool).toBe("bash");
    await expect(readFile(sideEffectFile, "utf8")).rejects.toThrow();
  });

  it("bypass executes bash command and captures real output", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "core-bypass-bash-"));
    const outFile = path.join(tmpDir, "out.txt");
    const result = await runLoop({
      session: createSession({ mode: "bypass" }),
      prompt: "run bash",
      print: true,
      model: fakeModel([
        {
          text: "",
          toolCalls: [
            {
              id: "bash-1",
              name: "bash",
              arguments: { command: `echo "hello from bypass" > "${outFile}" && echo "harmless stdout"` },
            },
          ],
        },
        { text: "bash completed", toolCalls: [] },
      ]),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/bash completed/);
    expect(await readFile(outFile, "utf8")).toBe("hello from bypass\n");
    const toolMsg = result.session.messages.find((m) => m.role === "tool");
    expect(toolMsg?.name).toBe("bash");
    const parsed = JSON.parse(toolMsg?.content ?? "{}");
    expect(parsed.success).toBe(true);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.stdout).toMatch(/harmless stdout/);
  });

  it("passes registered tools with parameters schemas to model.complete", async () => {
    let receivedTools: { name: string; description: string; parameters?: Record<string, unknown> }[] = [];
    const model: ModelClient = {
      async complete(input) {
        receivedTools = input.tools;
        return { text: "done", toolCalls: [] };
      },
    };
    await runLoop({
      session: createSession(),
      prompt: "test",
      model,
    });
    expect(receivedTools).toHaveLength(6);
    const readTool = receivedTools.find((t) => t.name === "read");
    expect(readTool?.parameters).toEqual({
      type: "object",
      properties: {
        path: {
          type: "string",
          description: expect.any(String),
        },
      },
      required: ["path"],
    });
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
  it("onApprove allow lets a gated write run when not print", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "core-loop-"));
    const file = path.join(tmpDir, "target.txt");
    await writeFile(file, "before\n");
    const result = await runLoop({
      session: createSession({ mode: "plan" }),
      prompt: "write it",
      model: fakeModel([
        {
          text: "",
          toolCalls: [
            {
              id: "1",
              name: "write",
              arguments: { path: file, content: "after\n" },
            },
          ],
        },
        { text: "done", toolCalls: [] },
      ]),
      onApprove: async () => "allow",
    });
    expect(result.exitCode).toBe(0);
    expect(await readFile(file, "utf8")).toBe("after\n");
  });

  it("print stays fail-closed even if onApprove is passed", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "core-loop-"));
    const file = path.join(tmpDir, "target.txt");
    await writeFile(file, "before\n");
    let asked = false;
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
      onApprove: async () => {
        asked = true;
        return "allow";
      },
    });
    expect(asked).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(await readFile(file, "utf8")).toBe("before\n");
  });

});

describe("createOpenAIClient", () => {
  it("passes tool parameters schema and falls back if missing", async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: any;
    globalThis.fetch = (async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "ok", tool_calls: [] } }],
        }),
      } as any;
    }) as any;

    try {
      const client = createOpenAIClient({ OPENAI_API_KEY: "test-key" });
      await client.complete({
        messages: [{ role: "user", content: "test" }],
        tools: [
          {
            name: "tool_with_schema",
            description: "desc 1",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
          {
            name: "tool_without_schema",
            description: "desc 2",
          },
        ],
      });

      expect(capturedBody.tools).toEqual([
        {
          type: "function",
          function: {
            name: "tool_with_schema",
            description: "desc 1",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "tool_without_schema",
            description: "desc 2",
            parameters: { type: "object", additionalProperties: true },
          },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

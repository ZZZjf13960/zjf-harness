import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import {
  createSession,
  setWorkspaceRoot,
  resetWorkspaceRoot,
  type ModelClient,
  type ModelTurn,
} from "@zjf-harness/core";
import { createRpcServer, type JsonRpcRequest } from "./index";

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

function req(
  id: string | number,
  method: string,
  params?: unknown,
): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}

describe("createRpcServer handleRequest", () => {
  let tmpDir: string | undefined;

  async function makeTmp(prefix: string): Promise<string> {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), prefix));
    setWorkspaceRoot(tmpDir);
    return tmpDir;
  }

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
    resetWorkspaceRoot();
  });

  it("ping", async () => {
    const server = createRpcServer();
    const res = await server.handleRequest(req(1, "ping"));
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({ ok: true });
  });

  it("session.get / setMode / illegal mode errors", async () => {
    const session = createSession({ mode: "plan", workspaceRoot: "/tmp/ws" });
    const server = createRpcServer({ session });

    const got = await server.handleRequest(req(1, "session.get"));
    expect(got.result).toEqual({
      mode: "plan",
      workspaceRoot: "/tmp/ws",
      messageCount: 0,
    });

    const set = await server.handleRequest(
      req(2, "session.setMode", { mode: "bypass" }),
    );
    expect(set.error).toBeUndefined();
    expect(set.result).toEqual({ mode: "bypass" });
    expect(session.mode).toBe("bypass");

    const illegal = await server.handleRequest(
      req(3, "session.setMode", { mode: "full-auto" }),
    );
    expect(illegal.result).toBeUndefined();
    expect(illegal.error?.code).toBe(-32602);
    expect(illegal.error?.message).toMatch(/Invalid permission mode/);
    expect(session.mode).toBe("bypass");
  });

  it("prompt happy path (model returns text, no tools)", async () => {
    const session = createSession({ mode: "plan" });
    const server = createRpcServer({
      session,
      model: fakeModel([{ text: "hello from model", toolCalls: [] }]),
    });
    const res = await server.handleRequest(
      req(1, "prompt", { message: "say hi" }),
    );
    expect(res.error).toBeUndefined();
    const result = res.result as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/hello from model/);
    expect(result.stderr).toBe("");
    expect(session.messages.length).toBeGreaterThan(0);
  });

  it("prompt fail-closed under plan when model requests write", async () => {
    tmpDir = await makeTmp("rpc-loop-");
    const file = path.join(tmpDir, "target.txt");
    await writeFile(file, "before\n");
    const session = createSession({ mode: "plan", workspaceRoot: tmpDir });
    const server = createRpcServer({
      session,
      workspaceRoot: tmpDir,
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
    const res = await server.handleRequest(
      req(1, "prompt", { message: "write it" }),
    );
    expect(res.error).toBeUndefined();
    const result = res.result as {
      exitCode: number;
      stderr: string;
      gatedTool?: string;
    };
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/write/);
    expect(await readFile(file, "utf8")).toBe("before\n");
  });

  it("prompt without model returns error", async () => {
    const server = createRpcServer();
    const res = await server.handleRequest(
      req(1, "prompt", { message: "hi" }),
    );
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toMatch(/model/i);
  });

  it("unknown method → -32601", async () => {
    const server = createRpcServer();
    const res = await server.handleRequest(req(1, "nope"));
    expect(res.error?.code).toBe(-32601);
  });

  it("shutdown via handleRequest", async () => {
    const server = createRpcServer();
    const res = await server.handleRequest(req(1, "shutdown"));
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual({ ok: true });
  });
});

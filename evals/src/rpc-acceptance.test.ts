import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  shouldRunPreview,
  shouldRunRpc,
  shouldRunTui,
} from "@zjf-harness/cli";
import {
  createSession,
  resetWorkspaceRoot,
  setWorkspaceRoot,
  type ModelClient,
  type ModelTurn,
} from "@zjf-harness/core";
import { createRpcServer, type JsonRpcRequest } from "@zjf-harness/rpc";

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

describe("rpc acceptance (#27)", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
    resetWorkspaceRoot();
  });

  it("CLI --rpc routes to rpc, not preview/tui", () => {
    expect(shouldRunRpc(["--rpc"])).toBe(true);
    expect(shouldRunPreview(["--rpc", "hello"])).toBe(false);
    expect(shouldRunTui(["--rpc"])).toBe(false);
  });

  it("five methods: ping / session.get / setMode / prompt / shutdown", async () => {
    const session = createSession({ mode: "plan", workspaceRoot: "/tmp/ws" });
    const server = createRpcServer({
      session,
      model: fakeModel([{ text: "pong-text", toolCalls: [] }]),
    });

    expect((await server.handleRequest(req(1, "ping"))).result).toEqual({
      ok: true,
    });

    expect((await server.handleRequest(req(2, "session.get"))).result).toEqual({
      mode: "plan",
      workspaceRoot: "/tmp/ws",
      messageCount: 0,
    });

    const set = await server.handleRequest(
      req(3, "session.setMode", { mode: "accept-edits" }),
    );
    expect(set.error).toBeUndefined();
    expect(set.result).toEqual({ mode: "accept-edits" });
    expect(session.mode).toBe("accept-edits");

    const prompted = await server.handleRequest(
      req(4, "prompt", { message: "hi" }),
    );
    expect(prompted.error).toBeUndefined();
    const payload = prompted.result as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };
    expect(payload.exitCode).toBe(0);
    expect(payload.stdout).toMatch(/pong-text/);

    expect((await server.handleRequest(req(5, "shutdown"))).result).toEqual({
      ok: true,
    });
  });

  it("illegal setMode is -32602 and does not change mode", async () => {
    const session = createSession({ mode: "plan" });
    const server = createRpcServer({ session });
    const res = await server.handleRequest(
      req(1, "session.setMode", { mode: "full-auto" }),
    );
    expect(res.result).toBeUndefined();
    expect(res.error?.code).toBe(-32602);
    expect(session.mode).toBe("plan");
  });

  it("prompt without model is -32602", async () => {
    const server = createRpcServer();
    const res = await server.handleRequest(req(1, "prompt", { message: "hi" }));
    expect(res.error?.code).toBe(-32602);
    expect(res.error?.message).toMatch(/model/i);
  });

  it("prompt under plan is fail-closed like -p (write does not land)", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "zjf-rpc-accept-"));
    setWorkspaceRoot(tmpDir);
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
    expect(result.stderr).toMatch(/write|fail-closed|approval/i);
    expect(await readFile(file, "utf8")).toBe("before\n");
  });

  it("stdio JSONL serve roundtrips ping then shutdown", async () => {
    const server = createRpcServer();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: Buffer[] = [];
    stdout.on("data", (c) => chunks.push(Buffer.from(c)));

    const serving = server.serve(stdin, stdout);
    stdin.write(JSON.stringify(req(1, "ping")) + "\n");
    stdin.write(JSON.stringify(req(2, "shutdown")) + "\n");
    stdin.end();
    await serving;

    const lines = Buffer.concat(chunks)
      .toString("utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { id: number; result?: unknown });
    expect(lines).toHaveLength(2);
    expect(lines[0]!.id).toBe(1);
    expect(lines[0]!.result).toEqual({ ok: true });
    expect(lines[1]!.id).toBe(2);
    expect(lines[1]!.result).toEqual({ ok: true });
  });
});

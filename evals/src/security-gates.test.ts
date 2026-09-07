import { mkdtemp, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSession, runLoop } from "@zjf-harness/core";
import { canAutoRun, isHardDenied } from "@zjf-harness/permissions";
import {
  bashSync,
  resetWorkspaceRoot,
  setWorkspaceRoot,
  writeSync,
} from "@zjf-harness/tools";

afterEach(() => {
  resetWorkspaceRoot();
});

describe("security gate acceptance", () => {
  it("workspace jail blocks writes outside the root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "zjf-jail-"));
    const outside = path.join(os.tmpdir(), "zjf-outside-" + Date.now() + ".txt");
    setWorkspaceRoot(root);
    expect(() => writeSync({ path: outside, content: "nope" })).toThrow(/outside workspace/);
    const inside = path.join(root, "ok.txt");
    expect(writeSync({ path: inside, content: "ok" }).path).toBe(inside);
  });

  it("workspace jail blocks symlink escape", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "zjf-jail-"));
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "zjf-out-"));
    const link = path.join(root, "escape");
    await symlink(outsideDir, link);
    setWorkspaceRoot(root);
    expect(() =>
      writeSync({ path: path.join(link, "pwn.txt"), content: "nope" }),
    ).toThrow(/outside workspace/);
  });

  it("bash timeout fails closed without hanging", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "zjf-bash-"));
    setWorkspaceRoot(root);
    const r = bashSync({ command: "sleep 2", timeoutMs: 200 });
    expect(r.success).toBe(false);
    expect(r.exitCode).toBe(124);
    expect(r.stderr).toMatch(/timed out/i);
  });

  it("bash output cap throws on overflow", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "zjf-bash-"));
    setWorkspaceRoot(root);
    expect(() =>
      bashSync({ command: "yes x | head -c 5000", maxBuffer: 64 }),
    ).toThrow(/exceeded limit|overflow/i);
  });

  it("bypass hard-denies dangerous bash and /etc writes", () => {
    expect(isHardDenied("bash", "rm -rf /")).toBe(true);
    expect(canAutoRun("bash", "bypass", { args: "rm -rf /" })).toBe(false);
    expect(canAutoRun("bash", "bypass", { args: "echo ok" })).toBe(true);
    expect(isHardDenied("write", { path: "/etc/passwd" })).toBe(true);
    expect(canAutoRun("write", "bypass", { args: { path: "/etc/passwd" } })).toBe(false);
  });

  it("runLoop hard-denies without calling onApprove", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "zjf-hard-"));
    let approved = 0;
    const session = createSession({ mode: "bypass", workspaceRoot: root });
    const r = await runLoop({
      session,
      prompt: "wipe root",
      workspaceRoot: root,
      model: {
        complete: async () => ({
          text: "",
          toolCalls: [{ id: "1", name: "bash", arguments: { command: "rm -rf /" } }],
        }),
      },
      onApprove: async () => {
        approved += 1;
        return "allow";
      },
    });
    expect(approved).toBe(0);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/hard-denied/i);
  });
});


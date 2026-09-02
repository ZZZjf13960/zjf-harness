import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPreview, shouldRunPreview } from "@zjf-harness/cli";
import { canAutoRun } from "@zjf-harness/permissions";

const printFlag = "-p";

function textModel(text: string) {
  return {
    complete: async () => ({ text, toolCalls: [] }),
  };
}

function writeModel(file: string) {
  return {
    complete: async () => ({
      text: "",
      toolCalls: [
        { id: "call-write", name: "write", arguments: { path: file, content: "nope" } },
      ],
    }),
  };
}

describe("preview smoke", () => {
  it("a prompt after the CLI enters preview in plan", () => {
    expect(shouldRunPreview(["list the repo"])).toBe(true);
  });

  it("default plan prompt completes read-only with a stub model", async () => {
    const r = await runPreview(["summarize this repo"], textModel("ok"));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/mode=plan/);
    expect(r.stdout).toMatch(/ok/);
  });

  it("default plan does not land a write requested by the model", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zjf-preview-"));
    const file = path.join(dir, "target.txt");
    await writeFile(file, "before");
    const r = await runPreview(["change the file"], writeModel(file));
    expect(r.exitCode).not.toBe(0);
    expect(await readFile(file, "utf8")).toBe("before");
  });

  it("print plus plan is fail-closed when the model requests write", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zjf-preview-"));
    const file = path.join(dir, "target.txt");
    await writeFile(file, "before");
    const r = await runPreview([printFlag, "change the file"], writeModel(file));
    expect(r.exitCode).not.toBe(0);
    expect(await readFile(file, "utf8")).toBe("before");
  });

  it("plan auto-runs read glob grep and still gates write", () => {
    expect(canAutoRun("read", "plan")).toBe(true);
    expect(canAutoRun("glob", "plan")).toBe(true);
    expect(canAutoRun("grep", "plan")).toBe(true);
    expect(canAutoRun("write", "plan")).toBe(false);
  });
});

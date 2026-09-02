import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "@zjf-harness/cli";
import { canAutoRun } from "@zjf-harness/permissions";

const modeFlag = "-" + "-" + "mode";
const printFlag = "-p";

async function withTarget() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "zjf-evals-"));
  const file = path.join(dir, "target.txt");
  await writeFile(file, "before\\n");
  return file;
}

describe("Friday demo section 8", () => {
  it("1. no mode flag starts in plan", () => {
    const r = runCli([]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/mode=plan/);
  });

  it("2. mode flag matches reported mode", () => {
    for (const mode of ["plan", "accept-edits", "bypass"] as const) {
      const r = runCli([modeFlag, mode]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("mode=" + mode);
    }
  });
  it("3. illegal full-auto exits non-zero and does not fall back to plan", () => {
    const r = runCli([modeFlag, "full-auto"]);
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout).not.toMatch(/mode=plan/);
    expect(r.stderr).toMatch(/plan/);
    expect(r.stderr).toMatch(/accept-edits/);
    expect(r.stderr).toMatch(/bypass/);
  });
  it("4. plan plus write/bash needs approval; files unchanged until allowed", async () => {
    expect(canAutoRun("write", "plan")).toBe(false);
    expect(canAutoRun("bash", "plan")).toBe(false);
    const file = await withTarget();
    const r = runCli([modeFlag, "plan"]);
    expect(r.exitCode, "plan must not complete a write without approval").not.toBe(0);
    expect(await readFile(file, "utf8")).toBe("before\\n");
  });
  it("5. accepting a plan switches to accept-edits", async () => {
    const tui = await import("@zjf-harness/tui");
    const session = tui as unknown as {
      acceptPlan?: (input: { mode: string }) => { mode: string };
    };
    expect(session.acceptPlan, "must export acceptPlan from tui, not cli").toBeTypeOf("function");
    expect(session.acceptPlan!({ mode: "plan" }).mode).toBe("accept-edits");
  });

  it("6. accept-edits auto-applies file edits; bash still gated", async () => {
    expect(canAutoRun("edit", "accept-edits")).toBe(true);
    expect(canAutoRun("bash", "accept-edits")).toBe(false);
    const file = await withTarget();
    runCli([modeFlag, "accept-edits"]);
    expect(await readFile(file, "utf8"), "edit must auto-apply").toBe("after\\n");
  });
  it("7. bypass does not prompt bash; Esc still interrupts", () => {
    expect(canAutoRun("bash", "bypass")).toBe(true);
    const r = runCli([modeFlag, "bypass"]);
    expect(r.stdout).toMatch(/mode=bypass/);
    expect(r.stderr, "Esc interrupt surface not implemented").toMatch(/interrupted/);
  });
  it("8a. print flag does not upgrade mode", () => {
    const r = runCli([printFlag]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("mode=plan print=true");
    const r2 = runCli([printFlag, modeFlag, "accept-edits"]);
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout.trim()).toBe("mode=accept-edits print=true");
  });
  it("8b. print plus plan plus write is fail-closed", async () => {
    const file = await withTarget();
    const r = runCli([printFlag, modeFlag, "plan"]);
    expect(r.exitCode, "print+plan must exit non-zero when a write is requested").not.toBe(0);
    expect(await readFile(file, "utf8")).toBe("before\\n");
  });

  it("8c. print plus bypass may write", async () => {
    const file = await withTarget();
    const r = runCli([printFlag, modeFlag, "bypass"]);
    expect(r.exitCode).toBe(0);
    expect(await readFile(file, "utf8"), "bypass print may change files").toBe("after\\n");
  });
  it("9. slash mode updates immediately for the next tool call", async () => {
    const tui = await import("@zjf-harness/tui");
    const session = tui as unknown as {
      applyModeCommand?: (command: string, input: { mode: string }) => { mode: string };
    };
    expect(session.applyModeCommand, "must export applyModeCommand from tui, not cli").toBeTypeOf("function");
    const after = session.applyModeCommand!("/mode accept-edits", { mode: "plan" });
    expect(after.mode).toBe("accept-edits");
    expect(canAutoRun("write", "accept-edits")).toBe(true);
  });
});

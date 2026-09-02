import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { runCli } from "./run";

describe("cli", () => {
  it("defaults to plan", () => {
    const r = runCli([]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("mode=plan print=false");
  });

  it("--mode accept-edits", () => {
    const r = runCli(["--mode", "accept-edits"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("mode=accept-edits print=false");
  });

  it("--mode bypass", () => {
    const r = runCli(["--mode", "bypass"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("mode=bypass print=false");
  });

  it("--mode full-auto exits 1", () => {
    const r = runCli(["--mode", "full-auto"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/plan/);
    expect(r.stderr).toMatch(/accept-edits/);
    expect(r.stderr).toMatch(/bypass/);
  });

  it("-p does not change mode", () => {
    const r = runCli(["-p"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("mode=plan print=true");
    const r2 = runCli(["-p", "--mode", "accept-edits"]);
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout.trim()).toBe("mode=accept-edits print=true");
  });

  it("--help lists modes and default plan", () => {
    const r = runCli(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/plan/);
    expect(r.stdout).toMatch(/accept-edits/);
    expect(r.stdout).toMatch(/bypass/);
    expect(r.stdout).toMatch(/default: plan/);
  });

  describe("tool execution permissions (--write / --edit)", () => {
    let tmpDir: string | undefined;

    afterEach(async () => {
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("--write under plan fails closed and does not touch file", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
      const file = path.join(tmpDir, "target.txt");
      await writeFile(file, "before\n");

      const r = runCli(["--write", file]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/write/);
      expect(r.stderr).toMatch(/approval/);
      expect(await readFile(file, "utf8")).toBe("before\n");
    });

    it("--edit under plan fails closed", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
      const file = path.join(tmpDir, "target.txt");
      await writeFile(file, "before\n");

      const r = runCli(["--mode", "plan", "--edit", file]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/edit/);
      expect(r.stderr).toMatch(/approval/);
      expect(await readFile(file, "utf8")).toBe("before\n");
    });

    it("-p with --write under plan fails closed with fail-closed in stderr", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
      const file = path.join(tmpDir, "target.txt");
      await writeFile(file, "before\n");

      const r = runCli(["-p", "--write", file]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/fail-closed/);
      expect(r.stderr).toMatch(/write/);
      expect(r.stderr).toMatch(/approval/);
      expect(await readFile(file, "utf8")).toBe("before\n");
    });

    it("-p --mode plan with --write fails closed", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
      const file = path.join(tmpDir, "target.txt");
      await writeFile(file, "before\n");

      const r = runCli(["-p", "--mode", "plan", "--write", file]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/fail-closed/);
      expect(await readFile(file, "utf8")).toBe("before\n");
    });

    it("--write under accept-edits writes after\\n", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
      const file = path.join(tmpDir, "target.txt");
      await writeFile(file, "before\n");

      const r = runCli(["--mode", "accept-edits", "--write", file]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe("mode=accept-edits print=false");
      expect(await readFile(file, "utf8")).toBe("after\n");
    });

    it("--edit under accept-edits writes after\\n", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
      const file = path.join(tmpDir, "target.txt");
      await writeFile(file, "before\n");

      const r = runCli(["--mode", "accept-edits", "--edit", file]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe("mode=accept-edits print=false");
      expect(await readFile(file, "utf8")).toBe("after\n");
    });

    it("--write under bypass writes after\\n", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
      const file = path.join(tmpDir, "target.txt");
      await writeFile(file, "before\n");

      const r = runCli(["--mode", "bypass", "--write", file]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe("mode=bypass print=false");
      expect(await readFile(file, "utf8")).toBe("after\n");
    });

    it("-p --mode bypass with --write writes after\\n", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
      const file = path.join(tmpDir, "target.txt");
      await writeFile(file, "before\n");

      const r = runCli(["-p", "--mode", "bypass", "--write", file]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe("mode=bypass print=true");
      expect(await readFile(file, "utf8")).toBe("after\n");
    });

    it("missing value for --write or --edit exits non-zero", () => {
      const r1 = runCli(["--write"]);
      expect(r1.exitCode).not.toBe(0);
      expect(r1.stderr).toMatch(/--write/);

      const r2 = runCli(["--edit"]);
      expect(r2.exitCode).not.toBe(0);
      expect(r2.stderr).toMatch(/--edit/);
    });

    it("--bash under plan fails closed and does not touch file", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
      const file = path.join(tmpDir, "target.txt");
      await writeFile(file, "before\n");

      const r = runCli(["--mode", "plan", "--bash", `echo -n "after" > "${file}"`]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/bash/);
      expect(r.stderr).toMatch(/approval/);
      expect(await readFile(file, "utf8")).toBe("before\n");
    });

    it("--bash defaults to plan and fails closed", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
      const file = path.join(tmpDir, "target.txt");
      await writeFile(file, "before\n");

      const r = runCli(["--bash", `echo -n "after" > "${file}"`]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/bash/);
      expect(r.stderr).toMatch(/approval/);
      expect(await readFile(file, "utf8")).toBe("before\n");
    });

    it("--bash under accept-edits is still gated and does not execute", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
      const file = path.join(tmpDir, "target.txt");
      await writeFile(file, "before\n");

      const r = runCli(["--mode", "accept-edits", "--bash", `echo -n "after" > "${file}"`]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/bash/);
      expect(r.stderr).toMatch(/approval/);
      expect(await readFile(file, "utf8")).toBe("before\n");
    });

    it("-p --mode plan --bash fails closed with fail-closed in stderr", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
      const file = path.join(tmpDir, "target.txt");
      await writeFile(file, "before\n");

      const r = runCli(["-p", "--mode", "plan", "--bash", `echo -n "after" > "${file}"`]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/fail-closed/);
      expect(r.stderr).toMatch(/bash/);
      expect(r.stderr).toMatch(/approval/);
      expect(await readFile(file, "utf8")).toBe("before\n");
    });

    it("-p --mode accept-edits --bash fails closed", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
      const file = path.join(tmpDir, "target.txt");
      await writeFile(file, "before\n");

      const r = runCli(["-p", "--mode", "accept-edits", "--bash", `echo -n "after" > "${file}"`]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toMatch(/fail-closed/);
      expect(await readFile(file, "utf8")).toBe("before\n");
    });

    it("--bash under bypass executes command and modifies file", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-test-"));
      const file = path.join(tmpDir, "target.txt");
      await writeFile(file, "before\n");

      const r = runCli(["--mode", "bypass", "--bash", `echo -n "after" > "${file}"`]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/mode=bypass print=false/);
      expect(await readFile(file, "utf8")).toBe("after");
    });

    it("--bash under bypass captures stdout", () => {
      const r = runCli(["--mode", "bypass", "--bash", "echo 'hello from bash'"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/mode=bypass print=false/);
      expect(r.stdout).toMatch(/hello from bash/);
      expect(r.stderr).toBe("");
    });

    it("-p --mode bypass --bash executes command", () => {
      const r = runCli(["-p", "--mode", "bypass", "--bash", "echo 'bypass print output'"]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toMatch(/mode=bypass print=true/);
      expect(r.stdout).toMatch(/bypass print output/);
      expect(r.stderr).toBe("");
    });

    it("--bash failing command returns non-zero and captures stderr", () => {
      const r = runCli(["--mode", "bypass", "--bash", "echo 'error output' >&2; exit 7"]);
      expect(r.exitCode).toBe(7);
      expect(r.stdout).toMatch(/mode=bypass print=false/);
      expect(r.stderr).toMatch(/error output/);
    });

    it("missing value for --bash exits non-zero", () => {
      const r1 = runCli(["--bash"]);
      expect(r1.exitCode).not.toBe(0);
      expect(r1.stderr).toMatch(/--bash/);

      const r2 = runCli(["--bash="]);
      expect(r2.exitCode).not.toBe(0);
      expect(r2.stderr).toMatch(/--bash/);

      const r3 = runCli(["--bash", "-p"]);
      expect(r3.exitCode).not.toBe(0);
      expect(r3.stderr).toMatch(/--bash/);
    });
  });
});

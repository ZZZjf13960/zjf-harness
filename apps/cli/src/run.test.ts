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

  describe("read / glob / grep tools (--read / --glob / --grep / --path)", () => {
    let tmpDir: string | undefined;

    afterEach(async () => {
      if (tmpDir) {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("--read auto-runs in plan mode (default) and prints file contents", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-read-"));
      const file = path.join(tmpDir, "hello.txt");
      await writeFile(file, "hello from plan read\n", "utf8");

      const r = runCli(["--read", file]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe("mode=plan print=false\nhello from plan read\n");
      expect(r.stderr).toBe("");
    });

    it("--read auto-runs in accept-edits and bypass modes", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-read-"));
      const file = path.join(tmpDir, "content.txt");
      await writeFile(file, "some file content\n", "utf8");

      const r1 = runCli(["--mode", "accept-edits", "--read", file]);
      expect(r1.exitCode).toBe(0);
      expect(r1.stdout).toBe("mode=accept-edits print=false\nsome file content\n");

      const r2 = runCli(["--mode", "bypass", "-p", `--read=${file}`]);
      expect(r2.exitCode).toBe(0);
      expect(r2.stdout).toBe("mode=bypass print=true\nsome file content\n");
    });

    it("--read on missing file fails with non-zero exit code", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-read-"));
      const missingFile = path.join(tmpDir, "missing.txt");

      const r = runCli(["--read", missingFile]);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).not.toBe("");
    });

    it("--read with missing value exits non-zero", () => {
      const r1 = runCli(["--read"]);
      expect(r1.exitCode).not.toBe(0);
      expect(r1.stderr).toMatch(/--read/);

      const r2 = runCli(["--read="]);
      expect(r2.exitCode).not.toBe(0);
      expect(r2.stderr).toMatch(/--read/);
    });

    it("--glob auto-runs in plan mode and prints matching paths", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-glob-"));
      await writeFile(path.join(tmpDir, "file2.txt"), "2");
      await writeFile(path.join(tmpDir, "file1.txt"), "1");

      const r = runCli(["--glob", "*.txt", "--path", tmpDir]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe("mode=plan print=false\nfile1.txt\nfile2.txt\n");
    });

    it("--glob auto-runs in accept-edits and bypass modes", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-glob-"));
      await writeFile(path.join(tmpDir, "alpha.json"), "{}");

      const r1 = runCli(["--mode", "accept-edits", "--glob=*.json", `--path=${tmpDir}`]);
      expect(r1.exitCode).toBe(0);
      expect(r1.stdout).toBe("mode=accept-edits print=false\nalpha.json\n");

      const r2 = runCli(["--mode", "bypass", "-p", "--glob", "*.json", "--path", tmpDir]);
      expect(r2.exitCode).toBe(0);
      expect(r2.stdout).toBe("mode=bypass print=true\nalpha.json\n");
    });

    it("--glob with missing value or invalid dir exits non-zero", () => {
      const r1 = runCli(["--glob"]);
      expect(r1.exitCode).not.toBe(0);
      expect(r1.stderr).toMatch(/--glob/);

      const r2 = runCli(["--glob", "*.txt", "--path", "/nonexistent_dir_123"]);
      expect(r2.exitCode).not.toBe(0);
      expect(r2.stderr).not.toBe("");
    });

    it("--grep auto-runs in plan mode and prints matching file:line:text", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-grep-"));
      const file = path.join(tmpDir, "test.txt");
      await writeFile(file, "first line\nmatch here 1\nthird line\nmatch here 2\n");

      const r = runCli(["--grep", "match here", "--path", file]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe(
        `mode=plan print=false\n${file}:2:match here 1\n${file}:4:match here 2\n`,
      );
    });

    it("--grep auto-runs in accept-edits and bypass modes across directory", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "cli-grep-"));
      const file1 = path.join(tmpDir, "a.txt");
      const file2 = path.join(tmpDir, "b.txt");
      await writeFile(file1, "keyword alpha\n");
      await writeFile(file2, "keyword beta\n");

      const r = runCli(["--mode", "bypass", "--grep", "keyword", "--path", tmpDir]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("mode=bypass print=false\n");
      expect(r.stdout).toContain("keyword alpha");
      expect(r.stdout).toContain("keyword beta");
    });

    it("--grep on missing file or invalid value exits non-zero", () => {
      const r1 = runCli(["--grep"]);
      expect(r1.exitCode).not.toBe(0);
      expect(r1.stderr).toMatch(/--grep/);

      const r2 = runCli(["--grep", "pattern", "--path", "/nonexistent_file_grep.txt"]);
      expect(r2.exitCode).not.toBe(0);
      expect(r2.stderr).not.toBe("");
    });
  });
});

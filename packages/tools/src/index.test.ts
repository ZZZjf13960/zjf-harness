import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { get, list, writeSync, editSync, bashSync, bashHandler } from "./index";

describe("tools", () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("lists all 6 tools", () => {
    const names = list().map((t) => t.name);
    expect(names).toEqual(["read", "bash", "glob", "grep", "write", "edit"]);
  });

  it("stubs throw not implemented", async () => {
    for (const name of ["read", "glob", "grep"] as const) {
      const tool = get(name);
      expect(tool).toBeDefined();
      await expect(tool!.run({})).rejects.toThrow("not implemented");
    }
  });

  it("bash tool executes command asynchronously", async () => {
    const bashTool = get("bash");
    expect(bashTool).toBeDefined();
    const result = (await bashTool!.run({ command: "echo 'hello bash'" })) as {
      success: boolean;
      exitCode: number;
      stdout: string;
      stderr: string;
    };
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello bash");
  });

  it("bashSync executes commands synchronously and captures stdout/stderr", () => {
    const res1 = bashSync("echo 'sync bash output'");
    expect(res1.success).toBe(true);
    expect(res1.exitCode).toBe(0);
    expect(res1.stdout.trim()).toBe("sync bash output");
    expect(res1.stderr).toBe("");

    const res2 = bashSync("echo 'error message' >&2; exit 42");
    expect(res2.success).toBe(false);
    expect(res2.exitCode).toBe(42);
    expect(res2.stderr.trim()).toBe("error message");
  });

  it("bashSync and bashHandler can write to a file", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-test-"));
    const file = path.join(tmpDir, "bash_out.txt");
    const res = await bashHandler(`echo -n "from bash" > "${file}"`);
    expect(res.success).toBe(true);
    expect(await readFile(file, "utf8")).toBe("from bash");
  });

  it("bash throws on missing command", () => {
    expect(() => bashSync("")).toThrow(/Missing command/);
    expect(() => bashSync({})).toThrow(/Missing command/);
    expect(() => bashSync(123)).toThrow(/Invalid arguments/);
  });

  it("write tool writes content asynchronously", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-test-"));
    const file = path.join(tmpDir, "out.txt");
    const writeTool = get("write");
    expect(writeTool).toBeDefined();
    await writeTool!.run({ path: file, content: "hello world\n" });
    expect(await readFile(file, "utf8")).toBe("hello world\n");
  });

  it("write tool defaults content to after\\n", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-test-"));
    const file = path.join(tmpDir, "out.txt");
    const writeTool = get("write");
    await writeTool!.run(file);
    expect(await readFile(file, "utf8")).toBe("after\n");
  });

  it("edit tool edits content asynchronously", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-test-"));
    const file = path.join(tmpDir, "out.txt");
    const editTool = get("edit");
    expect(editTool).toBeDefined();
    await editTool!.run({ path: file, content: "edited content\n" });
    expect(await readFile(file, "utf8")).toBe("edited content\n");
  });

  it("writeSync and editSync work synchronously", async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-test-"));
    const file1 = path.join(tmpDir, "sync1.txt");
    const file2 = path.join(tmpDir, "sync2.txt");
    writeSync(file1);
    expect(await readFile(file1, "utf8")).toBe("after\n");
    editSync(file2);
    expect(await readFile(file2, "utf8")).toBe("after\n");
  });
});

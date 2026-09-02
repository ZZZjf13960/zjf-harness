import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import { get, list, writeSync, editSync } from "./index";

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
    for (const name of ["read", "bash", "glob", "grep"] as const) {
      const tool = get(name);
      expect(tool).toBeDefined();
      await expect(tool!.run({})).rejects.toThrow("not implemented");
    }
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

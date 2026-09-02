import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import {
  get,
  list,
  writeSync,
  editSync,
  bashSync,
  bashHandler,
  readSync,
  readHandler,
  globSync,
  globHandler,
  grepSync,
  grepHandler,
} from "./index";

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

  describe("read tool", () => {
    it("readSync reads utf8 file content", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-read-"));
      const file = path.join(tmpDir, "sample.txt");
      await writeFile(file, "hello read tool\nline 2", "utf8");

      expect(readSync(file)).toBe("hello read tool\nline 2");
      expect(readSync({ path: file })).toBe("hello read tool\nline 2");
      expect(readSync({ filePath: file })).toBe("hello read tool\nline 2");
      expect(readSync({ file })).toBe("hello read tool\nline 2");
    });

    it("readHandler reads file content asynchronously", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-read-"));
      const file = path.join(tmpDir, "async.txt");
      await writeFile(file, "async content\n", "utf8");

      const res = await readHandler(file);
      expect(res).toBe("async content\n");

      const readTool = get("read");
      expect(readTool).toBeDefined();
      const toolRes = await readTool!.run({ path: file });
      expect(toolRes).toBe("async content\n");
    });

    it("read throws error on missing file", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-read-"));
      const missingFile = path.join(tmpDir, "nonexistent.txt");

      expect(() => readSync(missingFile)).toThrow();
      await expect(readHandler(missingFile)).rejects.toThrow();
    });

    it("read throws on missing/invalid arguments", () => {
      expect(() => readSync("")).toThrow(/Missing file path/);
      expect(() => readSync({})).toThrow(/Missing file path/);
      expect(() => readSync(123)).toThrow(/Invalid arguments/);
    });
  });

  describe("glob tool", () => {
    it("globSync matches files and returns sorted relative paths", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-glob-"));
      await mkdir(path.join(tmpDir, "sub"), { recursive: true });
      await writeFile(path.join(tmpDir, "b.txt"), "b");
      await writeFile(path.join(tmpDir, "a.txt"), "a");
      await writeFile(path.join(tmpDir, "sub", "c.txt"), "c");
      await writeFile(path.join(tmpDir, "sub", "d.md"), "d");

      const txtFiles = globSync({ pattern: "**/*.txt", cwd: tmpDir });
      expect(txtFiles).toEqual(["a.txt", "b.txt", "sub/c.txt"]);

      const rootTxt = globSync({ pattern: "*.txt", cwd: tmpDir });
      expect(rootTxt).toEqual(["a.txt", "b.txt"]);
    });

    it("globHandler works asynchronously and via registry", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-glob-"));
      await writeFile(path.join(tmpDir, "test.json"), "{}");

      const res = await globHandler({ pattern: "*.json", cwd: tmpDir });
      expect(res).toEqual(["test.json"]);

      const globTool = get("glob");
      expect(globTool).toBeDefined();
      const toolRes = (await globTool!.run({ pattern: "*.json", cwd: tmpDir })) as string[];
      expect(toolRes).toEqual(["test.json"]);
    });

    it("globSync returns empty array when no match", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-glob-"));
      const res = globSync({ pattern: "*.xyz", cwd: tmpDir });
      expect(res).toEqual([]);
    });

    it("globSync throws on missing pattern or invalid directory", () => {
      expect(() => globSync("")).toThrow(/Missing pattern/);
      expect(() => globSync({})).toThrow(/Missing pattern/);
      expect(() => globSync({ pattern: "*.txt", cwd: "/nonexistent_dir_glob_123" })).toThrow(/Directory not found/);
    });
  });

  describe("grep tool", () => {
    it("grepSync searches file contents for a string", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-grep-"));
      const file = path.join(tmpDir, "sample.txt");
      await writeFile(file, "apple pie\nbanana bread\npineapple tart\ncherry", "utf8");

      const res = grepSync({ pattern: "apple", path: file });
      expect(res).toEqual([
        `${file}:1:apple pie`,
        `${file}:3:pineapple tart`,
      ]);
    });

    it("grepSync searches with regex pattern", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-grep-"));
      const file = path.join(tmpDir, "sample.txt");
      await writeFile(file, "item 1\nskip line\nitem 42\nitem 999", "utf8");

      const res1 = grepSync({ pattern: /item \d+/, path: file });
      expect(res1).toEqual([
        `${file}:1:item 1`,
        `${file}:3:item 42`,
        `${file}:4:item 999`,
      ]);

      const res2 = grepSync({ pattern: "item \\d{2}$", path: file });
      expect(res2).toEqual([
        `${file}:3:item 42`,
      ]);
    });

    it("grepSync searches directories and glob patterns", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-grep-"));
      await mkdir(path.join(tmpDir, "sub"), { recursive: true });
      await writeFile(path.join(tmpDir, "a.txt"), "hello world\nfoo bar\n");
      await writeFile(path.join(tmpDir, "sub", "b.txt"), "goodbye\nhello again\n");

      const resDir = grepSync({ pattern: "hello", path: tmpDir });
      expect(resDir).toEqual([
        `${path.join(tmpDir, "a.txt")}:1:hello world`,
        `${path.join(tmpDir, "sub", "b.txt")}:2:hello again`,
      ]);

      const resGlob = grepSync({ pattern: "hello", glob: "**/*.txt", cwd: tmpDir });
      expect(resGlob).toEqual([
        "a.txt:1:hello world",
        "sub/b.txt:2:hello again",
      ]);
    });

    it("grepHandler works asynchronously and via registry", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-grep-"));
      const file = path.join(tmpDir, "test.txt");
      await writeFile(file, "line one\nfind me\nline three", "utf8");

      const res = await grepHandler({ pattern: "find me", path: file });
      expect(res).toEqual([`${file}:2:find me`]);

      const grepTool = get("grep");
      expect(grepTool).toBeDefined();
      const toolRes = (await grepTool!.run({ pattern: "find me", path: file })) as string[];
      expect(toolRes).toEqual([`${file}:2:find me`]);
    });

    it("grep throws on missing file or pattern", async () => {
      tmpDir = await mkdtemp(path.join(os.tmpdir(), "tools-grep-"));
      const missingFile = path.join(tmpDir, "missing.txt");

      expect(() => grepSync({ pattern: "foo", path: missingFile })).toThrow();
      expect(() => grepSync({})).toThrow(/Missing pattern/);
    });
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

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type ToolName = "read" | "write" | "edit" | "bash" | "glob" | "grep";

export type ToolHandler = (args: unknown) => Promise<unknown>;

export type Tool = {
  name: ToolName;
  description: string;
  run: ToolHandler;
  parameters?: Record<string, unknown>;
};

export type WriteToolArgs =
  | string
  | {
      path?: string;
      filePath?: string;
      file?: string;
      content?: string;
      text?: string;
    };

export type EditToolArgs = {
  path?: string;
  filePath?: string;
  file?: string;
  oldText?: string;
  newText?: string;
  content?: string;
  text?: string;
};

export type FileToolArgs = WriteToolArgs | EditToolArgs;

export type EditResult = {
  success: boolean;
  path: string;
  diff: string;
};

export type ReadToolArgs =
  | string
  | {
      path?: string;
      filePath?: string;
      file?: string;
    };

export type GlobToolArgs =
  | string
  | {
      pattern?: string;
      glob?: string;
      cwd?: string;
      path?: string;
    };

export type GrepToolArgs =
  | string
  | {
      pattern?: string | RegExp;
      query?: string;
      search?: string;
      path?: string;
      filePath?: string;
      file?: string;
      glob?: string;
      cwd?: string;
      isRegex?: boolean;
    };

export type BashToolArgs =
  | string
  | {
      command?: string;
      cmd?: string;
      cwd?: string;
    };

export type BashResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
};

function extractPathAndContent(args: unknown): { targetPath: string; content: string } {
  if (typeof args === "string") {
    return { targetPath: args, content: "after\n" };
  }
  if (typeof args === "object" && args !== null) {
    const obj = args as Record<string, unknown>;
    const targetPath = (obj.path ?? obj.filePath ?? obj.file) as string | undefined;
    if (!targetPath || typeof targetPath !== "string") {
      throw new Error("Missing file path for filesystem tool");
    }
    const content = (obj.content ?? obj.newText ?? obj.text ?? "after\n") as string;
    return { targetPath, content: String(content) };
  }
  throw new Error("Invalid arguments for filesystem tool");
}

function extractReadPath(args: unknown): string {
  if (typeof args === "string") {
    if (!args) {
      throw new Error("Missing file path for read tool");
    }
    return args;
  }
  if (typeof args === "object" && args !== null) {
    const obj = args as Record<string, unknown>;
    const targetPath = (obj.path ?? obj.filePath ?? obj.file) as string | undefined;
    if (!targetPath || typeof targetPath !== "string") {
      throw new Error("Missing file path for read tool");
    }
    return targetPath;
  }
  throw new Error("Invalid arguments for read tool");
}

function extractCommand(args: unknown): { command: string; cwd?: string } {
  if (typeof args === "string") {
    if (!args) {
      throw new Error("Missing command for bash tool");
    }
    return { command: args };
  }
  if (typeof args === "object" && args !== null) {
    const obj = args as Record<string, unknown>;
    const command = (obj.command ?? obj.cmd) as string | undefined;
    if (!command || typeof command !== "string") {
      throw new Error("Missing command for bash tool");
    }
    const cwd = typeof obj.cwd === "string" ? obj.cwd : undefined;
    return { command, cwd };
  }
  throw new Error("Invalid arguments for bash tool");
}

function extractGlobArgs(args: unknown): { pattern: string; cwd?: string } {
  if (typeof args === "string") {
    if (!args) {
      throw new Error("Missing pattern for glob tool");
    }
    return { pattern: args };
  }
  if (typeof args === "object" && args !== null) {
    const obj = args as Record<string, unknown>;
    const pattern = (obj.pattern ?? obj.glob) as string | undefined;
    if (!pattern || typeof pattern !== "string") {
      throw new Error("Missing pattern for glob tool");
    }
    const cwd = (obj.cwd ?? obj.path) as string | undefined;
    return { pattern, cwd: typeof cwd === "string" ? cwd : undefined };
  }
  throw new Error("Invalid arguments for glob tool");
}

function extractGrepArgs(args: unknown): {
  pattern: string | RegExp;
  path?: string;
  glob?: string;
  cwd?: string;
} {
  if (typeof args === "string") {
    if (!args && args !== "") {
      throw new Error("Missing pattern for grep tool");
    }
    return { pattern: args };
  }
  if (typeof args === "object" && args !== null) {
    const obj = args as Record<string, unknown>;
    const pattern = (obj.pattern ?? obj.query ?? obj.search) as string | RegExp | undefined;
    if (pattern === undefined || (typeof pattern !== "string" && !(pattern instanceof RegExp))) {
      throw new Error("Missing pattern for grep tool");
    }
    const targetPath = (obj.path ?? obj.filePath ?? obj.file) as string | undefined;
    const glob = obj.glob as string | undefined;
    const cwd = obj.cwd as string | undefined;
    return {
      pattern,
      path: typeof targetPath === "string" ? targetPath : undefined,
      glob: typeof glob === "string" ? glob : undefined,
      cwd: typeof cwd === "string" ? cwd : undefined,
    };
  }
  throw new Error("Invalid arguments for grep tool");
}

export function readSync(args: unknown): string {
  const targetPath = extractReadPath(args);
  return fs.readFileSync(targetPath, "utf8");
}

export async function readHandler(args: unknown): Promise<string> {
  const targetPath = extractReadPath(args);
  return await readFile(targetPath, "utf8");
}

export function globSync(args: unknown): string[] {
  const { pattern, cwd } = extractGlobArgs(args);
  const effectiveCwd = cwd ? path.resolve(cwd) : process.cwd();
  if (!fs.existsSync(effectiveCwd)) {
    throw new Error(`Directory not found: ${effectiveCwd}`);
  }
  if (typeof fs.globSync === "function") {
    const matches = Array.from(fs.globSync(pattern, { cwd: effectiveCwd }));
    return matches.map(String).sort();
  }
  return fallbackGlob(pattern, effectiveCwd);
}

export async function globHandler(args: unknown): Promise<string[]> {
  return globSync(args);
}

function fallbackGlob(pattern: string, cwd: string): string[] {
  const results: string[] = [];
  function walk(dir: string, rel: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryRel = rel ? path.join(rel, entry.name) : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, entryRel);
      } else if (entry.isFile()) {
        results.push(entryRel);
      }
    }
  }
  walk(cwd, "");
  return results.sort();
}

export function grepSync(args: unknown): string[] {
  const { pattern, path: searchPath, glob: globPattern, cwd: customCwd } = extractGrepArgs(args);
  const cwd = customCwd ? path.resolve(customCwd) : process.cwd();

  let matchFn: (line: string) => boolean;
  if (pattern instanceof RegExp) {
    const flags = pattern.flags.replace(/g/g, "");
    const re = new RegExp(pattern.source, flags);
    matchFn = (line) => re.test(line);
  } else {
    try {
      const re = new RegExp(pattern);
      matchFn = (line) => re.test(line);
    } catch {
      matchFn = (line) => line.includes(pattern);
    }
  }

  const results: string[] = [];

  function searchFile(fullPath: string, displayPath: string) {
    let content: string;
    try {
      content = fs.readFileSync(fullPath, "utf8");
    } catch (err) {
      if (searchPath && !fs.existsSync(fullPath)) {
        throw err;
      }
      return;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (matchFn(lines[i]!)) {
        results.push(`${displayPath}:${i + 1}:${lines[i]}`);
      }
    }
  }

  if (globPattern) {
    const baseDir = searchPath ? path.resolve(cwd, searchPath) : cwd;
    if (!fs.existsSync(baseDir)) {
      throw new Error(`Directory not found: ${searchPath}`);
    }
    const matches = Array.from(fs.globSync(globPattern, { cwd: baseDir })).map(String).sort();
    for (const rel of matches) {
      const full = path.resolve(baseDir, rel);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        const display = searchPath && searchPath !== "." ? path.join(searchPath, rel) : rel;
        searchFile(full, display);
      }
    }
  } else if (searchPath) {
    const target = path.resolve(cwd, searchPath);
    if (!fs.existsSync(target)) {
      throw new Error(`Path not found: ${searchPath}`);
    }
    const stat = fs.statSync(target);
    if (stat.isFile()) {
      searchFile(target, searchPath);
    } else if (stat.isDirectory()) {
      const matches = Array.from(fs.globSync("**/*", { cwd: target })).map(String).sort();
      for (const rel of matches) {
        const full = path.resolve(target, rel);
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          const display = searchPath !== "." ? path.join(searchPath, rel) : rel;
          searchFile(full, display);
        }
      }
    }
  } else {
    const matches = Array.from(fs.globSync("**/*", { cwd })).map(String).sort();
    for (const rel of matches) {
      const full = path.resolve(cwd, rel);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        searchFile(full, rel);
      }
    }
  }

  return results;
}

export async function grepHandler(args: unknown): Promise<string[]> {
  return grepSync(args);
}

export function bashSync(args: unknown): BashResult {
  const { command, cwd } = extractCommand(args);
  const res = spawnSync(command, {
    shell: "/bin/bash",
    encoding: "utf8",
    cwd,
  });
  const exitCode = res.status ?? (res.error ? 1 : 0);
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? (res.error ? res.error.message : "");
  return {
    success: exitCode === 0,
    exitCode,
    stdout,
    stderr,
  };
}

export async function bashHandler(args: unknown): Promise<BashResult> {
  return bashSync(args);
}

export function writeSync(args: unknown): { success: boolean; path: string } {
  const { targetPath, content } = extractPathAndContent(args);
  const dir = path.dirname(targetPath);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(targetPath, content, "utf8");
  return { success: true, path: targetPath };
}

export async function writeHandler(args: unknown): Promise<{ success: boolean; path: string }> {
  const { targetPath, content } = extractPathAndContent(args);
  const dir = path.dirname(targetPath);
  if (dir) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(targetPath, content, "utf8");
  return { success: true, path: targetPath };
}

function extractEditArgs(args: unknown): {
  targetPath: string;
  oldText: string;
  newText: string;
} {
  if (typeof args !== "object" || args === null) {
    throw new Error("Invalid arguments for edit tool: expected object with path, oldText, newText");
  }
  const obj = args as Record<string, unknown>;
  const targetPath = (obj.path ?? obj.filePath ?? obj.file) as string | undefined;
  if (!targetPath || typeof targetPath !== "string") {
    throw new Error("Missing file path for edit tool");
  }
  if (obj.oldText === undefined || typeof obj.oldText !== "string") {
    throw new Error("Missing oldText for edit tool");
  }
  const newText = obj.newText !== undefined ? obj.newText : (obj.content ?? obj.text);
  if (newText === undefined || typeof newText !== "string") {
    throw new Error("Missing newText for edit tool");
  }
  return {
    targetPath,
    oldText: obj.oldText,
    newText: String(newText),
  };
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function myersDiff(
  a: string[],
  b: string[],
): Array<{ type: "keep" | "insert" | "delete"; line: string }> {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v: number[] = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  v[max + 1] = 0;

  let reachedD = -1;
  for (let d = 0; d <= max; d++) {
    trace.push([...v]);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[max + k - 1]! < v[max + k + 1]!)) {
        x = v[max + k + 1]!;
      } else {
        x = v[max + k - 1]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[max + k] = x;
      if (x >= n && y >= m) {
        reachedD = d;
        break;
      }
    }
    if (reachedD !== -1) break;
  }

  const script: Array<{ type: "keep" | "insert" | "delete"; line: string }> = [];
  let x = n;
  let y = m;
  for (let d = reachedD; d > 0; d--) {
    const prevV = trace[d]!;
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && prevV[max + k - 1]! < prevV[max + k + 1]!)) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = prevV[max + prevK]!;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      script.push({ type: "keep", line: a[x - 1]! });
      x--;
      y--;
    }
    if (x === prevX) {
      script.push({ type: "insert", line: b[prevY]! });
      y--;
    } else {
      script.push({ type: "delete", line: a[prevX]! });
      x--;
    }
  }
  while (x > 0 && y > 0) {
    script.push({ type: "keep", line: a[x - 1]! });
    x--;
    y--;
  }
  script.reverse();
  return script;
}

function formatRange(start: number, count: number): string {
  if (count === 1) return `${start}`;
  return `${start},${count}`;
}

export function formatUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
): string {
  if (before === after) return "";
  const a = splitLines(before);
  const b = splitLines(after);
  const script = myersDiff(a, b);

  const editIndices: number[] = [];
  for (let i = 0; i < script.length; i++) {
    if (script[i]!.type !== "keep") {
      editIndices.push(i);
    }
  }
  if (editIndices.length === 0) return "";

  const context = 3;
  const groups: number[][] = [];
  let currentGroup = [editIndices[0]!];
  for (let i = 1; i < editIndices.length; i++) {
    const prev = editIndices[i - 1]!;
    const curr = editIndices[i]!;
    if (curr - prev <= 2 * context) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  groups.push(currentGroup);

  const cleanPath = filePath.replace(/^(\.\/|\/)+/, "");
  let result = `--- a/${cleanPath}\n+++ b/${cleanPath}\n`;

  for (const group of groups) {
    const firstEdit = group[0]!;
    const lastEdit = group[group.length - 1]!;
    const startIdx = Math.max(0, firstEdit - context);
    const endIdx = Math.min(script.length - 1, lastEdit + context);

    let oldCount = 0;
    let newCount = 0;
    let oldLineNum = 0;
    let newLineNum = 0;

    for (let i = 0; i < startIdx; i++) {
      if (script[i]!.type === "keep" || script[i]!.type === "delete") oldLineNum++;
      if (script[i]!.type === "keep" || script[i]!.type === "insert") newLineNum++;
    }

    const hunkLines: string[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const item = script[i]!;
      if (item.type === "keep") {
        oldCount++;
        newCount++;
        hunkLines.push(" " + item.line);
      } else if (item.type === "delete") {
        oldCount++;
        hunkLines.push("-" + item.line);
      } else if (item.type === "insert") {
        newCount++;
        hunkLines.push("+" + item.line);
      }
    }

    const oldStart = oldCount === 0 ? 0 : oldLineNum + 1;
    const newStart = newCount === 0 ? 0 : newLineNum + 1;

    result += `@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@\n`;
    result += hunkLines.join("\n") + "\n";
  }

  return result;
}

export function previewEdit(args: unknown): string {
  const { targetPath, oldText, newText } = extractEditArgs(args);
  const before = fs.readFileSync(targetPath, "utf8");
  const index = before.indexOf(oldText);
  if (index === -1) {
    throw new Error(`oldText not found in file: ${targetPath}`);
  }
  const after = before.slice(0, index) + newText + before.slice(index + oldText.length);
  return formatUnifiedDiff(targetPath, before, after);
}

export function previewWrite(args: unknown): string {
  const { targetPath, content } = extractPathAndContent(args);
  let before = "";
  try {
    before = fs.readFileSync(targetPath, "utf8");
  } catch {
    before = "";
  }
  return formatUnifiedDiff(targetPath, before, content);
}

export function editSync(args: unknown): EditResult {
  const { targetPath, oldText, newText } = extractEditArgs(args);
  const before = fs.readFileSync(targetPath, "utf8");
  const index = before.indexOf(oldText);
  if (index === -1) {
    throw new Error(`oldText not found in file: ${targetPath}`);
  }
  const after = before.slice(0, index) + newText + before.slice(index + oldText.length);
  const diff = formatUnifiedDiff(targetPath, before, after);
  const dir = path.dirname(targetPath);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(targetPath, after, "utf8");
  return { success: true, path: targetPath, diff };
}

export async function editHandler(args: unknown): Promise<EditResult> {
  const { targetPath, oldText, newText } = extractEditArgs(args);
  const before = await readFile(targetPath, "utf8");
  const index = before.indexOf(oldText);
  if (index === -1) {
    throw new Error(`oldText not found in file: ${targetPath}`);
  }
  const after = before.slice(0, index) + newText + before.slice(index + oldText.length);
  const diff = formatUnifiedDiff(targetPath, before, after);
  const dir = path.dirname(targetPath);
  if (dir) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(targetPath, after, "utf8");
  return { success: true, path: targetPath, diff };
}


const registry = new Map<string, Tool>();

export function register(tool: Tool): void {
  registry.set(tool.name, tool);
}

export function get(name: string): Tool | undefined {
  return registry.get(name);
}

export function list(): Tool[] {
  return [...registry.values()];
}

register({
  name: "read",
  description: "Read content from a file",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to read",
      },
    },
    required: ["path"],
  },
  run: readHandler,
});

register({
  name: "bash",
  description: "Execute a bash command",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Command to execute",
      },
      cwd: {
        type: "string",
        description: "Optional working directory",
      },
    },
    required: ["command"],
  },
  run: bashHandler,
});

register({
  name: "glob",
  description: "Match files under a cwd with a glob pattern",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Glob pattern to match files",
      },
      cwd: {
        type: "string",
        description: "Directory to search within",
      },
      path: {
        type: "string",
        description: "Directory path to search in (optional alias for cwd)",
      },
    },
    required: ["pattern"],
  },
  run: globHandler,
});

register({
  name: "grep",
  description: "Search file contents for a pattern",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Pattern or text to search for",
      },
      path: {
        type: "string",
        description: "File or directory path to search within",
      },
      glob: {
        type: "string",
        description: "Glob pattern to filter files",
      },
    },
    required: ["pattern"],
  },
  run: grepHandler,
});

register({
  name: "write",
  description: "Write content to a file",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to write",
      },
      content: {
        type: "string",
        description: "Content to write to the file",
      },
    },
    required: ["path", "content"],
  },
  run: writeHandler,
});

register({
  name: "edit",
  description: "Edit a file by replacing oldText with newText",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to edit",
      },
      oldText: {
        type: "string",
        description: "Exact text to be replaced",
      },
      newText: {
        type: "string",
        description: "New text to replace oldText with",
      },
    },
    required: ["path", "oldText", "newText"],
  },
  run: editHandler,
});



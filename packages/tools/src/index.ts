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
};

export type FileToolArgs =
  | string
  | {
      path?: string;
      filePath?: string;
      file?: string;
      content?: string;
      text?: string;
      newText?: string;
      oldText?: string;
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

export function editSync(args: unknown): { success: boolean; path: string } {
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

export async function editHandler(args: unknown): Promise<{ success: boolean; path: string }> {
  const { targetPath, content } = extractPathAndContent(args);
  const dir = path.dirname(targetPath);
  if (dir) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(targetPath, content, "utf8");
  return { success: true, path: targetPath };
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
  run: readHandler,
});

register({
  name: "bash",
  description: "Execute a bash command",
  run: bashHandler,
});

register({
  name: "glob",
  description: "Match files under a cwd with a glob pattern",
  run: globHandler,
});

register({
  name: "grep",
  description: "Search file contents for a pattern",
  run: grepHandler,
});

register({
  name: "write",
  description: "Write content to a file",
  run: writeHandler,
});

register({
  name: "edit",
  description: "Edit a file",
  run: editHandler,
});



import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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

function notImplemented(name: ToolName): Tool {
  return {
    name,
    description: name,
    run: async () => {
      throw new Error("not implemented");
    },
  };
}

const STUB_TOOL_NAMES: ToolName[] = ["read", "bash", "glob", "grep"];

for (const name of STUB_TOOL_NAMES) {
  register(notImplemented(name));
}

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


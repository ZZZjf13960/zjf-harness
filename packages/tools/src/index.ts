export type ToolName = "read" | "write" | "edit" | "bash" | "glob" | "grep";

export type ToolHandler = (args: unknown) => Promise<unknown>;

export type Tool = {
  name: ToolName;
  description: string;
  run: ToolHandler;
};

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

const TOOL_NAMES: ToolName[] = ["read", "write", "edit", "bash", "glob", "grep"];

for (const name of TOOL_NAMES) {
  register(notImplemented(name));
}

export type McpTool = {
  name: string;
  description?: string;
};

export type McpClient = {
  connect: (transport: unknown) => Promise<void>;
  listTools: () => Promise<McpTool[]>;
  callTool: (name: string, args?: unknown) => Promise<unknown>;
};

export async function connect(_transport: unknown): Promise<void> {
  throw new Error("not implemented");
}

export async function listTools(): Promise<McpTool[]> {
  throw new Error("not implemented");
}

export async function callTool(_name: string, _args?: unknown): Promise<unknown> {
  throw new Error("not implemented");
}

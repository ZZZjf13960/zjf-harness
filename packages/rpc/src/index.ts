import readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  createSession,
  runLoop,
  type ModelClient,
  type Session,
} from "@zjf-harness/core";
import { parsePermissionMode } from "@zjf-harness/permissions";

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type RpcServerOptions = {
  session?: Session;
  model?: ModelClient;
  workspaceRoot?: string;
  onEvent?: (msg: unknown) => void;
};

export type RpcServer = {
  handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse>;
  serve(stdin: Readable, stdout: Writable): Promise<void>;
};

const PARSE_ERROR = -32700;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function fail(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryExtractId(line: string): JsonRpcId | undefined {
  const match = /"id"\s*:\s*(null|"([^"\\]|\\.)*"|-?\d+(?:\.\d+)?)/.exec(line);
  if (!match) return undefined;
  const raw = match[1]!;
  if (raw === "null") return null;
  if (raw.startsWith('"')) {
    try {
      return JSON.parse(raw) as string;
    } catch {
      return undefined;
    }
  }
  const num = Number(raw);
  return Number.isFinite(num) ? num : undefined;
}

export function createRpcServer(options?: RpcServerOptions): RpcServer {
  const workspaceRoot = options?.workspaceRoot;
  const session =
    options?.session ??
    createSession({
      workspaceRoot,
    });
  if (workspaceRoot !== undefined && session.workspaceRoot === undefined) {
    session.workspaceRoot = workspaceRoot;
  }
  const model = options?.model;
  const onEvent = options?.onEvent;

  let shutdownRequested = false;

  async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
      return fail(id, INVALID_PARAMS, "Invalid JSON-RPC request");
    }

    try {
      switch (req.method) {
        case "ping":
          return ok(id, { ok: true });

        case "session.get":
          return ok(id, {
            mode: session.mode,
            workspaceRoot: session.workspaceRoot,
            messageCount: session.messages.length,
          });

        case "session.setMode": {
          if (!isRecord(req.params) || typeof req.params.mode !== "string") {
            return fail(
              id,
              INVALID_PARAMS,
              "session.setMode requires params.mode string",
            );
          }
          try {
            session.mode = parsePermissionMode(req.params.mode);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return fail(id, INVALID_PARAMS, message);
          }
          return ok(id, { mode: session.mode });
        }

        case "prompt": {
          if (!isRecord(req.params) || typeof req.params.message !== "string") {
            return fail(
              id,
              INVALID_PARAMS,
              "prompt requires params.message string",
            );
          }
          if (!model) {
            return fail(
              id,
              INVALID_PARAMS,
              "prompt requires a model client (set OPENAI_API_KEY or pass model)",
            );
          }
          const result = await runLoop({
            session,
            prompt: req.params.message,
            model,
            print: true,
            workspaceRoot: session.workspaceRoot ?? workspaceRoot,
          });
          const payload: {
            exitCode: number;
            stdout: string;
            stderr: string;
            gatedTool?: string;
          } = {
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
          };
          if (result.gatedTool !== undefined) {
            payload.gatedTool = result.gatedTool;
          }
          onEvent?.({ method: "prompt.done", result: payload });
          return ok(id, payload);
        }

        case "shutdown":
          shutdownRequested = true;
          return ok(id, { ok: true });

        default:
          return fail(id, METHOD_NOT_FOUND, "Method not found: " + req.method);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(id, INTERNAL_ERROR, message);
    }
  }

  async function serve(stdin: Readable, stdout: Writable): Promise<void> {
    shutdownRequested = false;
    const rl = readline.createInterface({
      input: stdin,
      crlfDelay: Infinity,
    });

    try {
      for await (const line of rl) {
        if (line === "") continue;

        let req: JsonRpcRequest;
        try {
          const parsed: unknown = JSON.parse(line);
          if (!isRecord(parsed)) {
            throw new Error("Request must be a JSON object");
          }
          req = parsed as JsonRpcRequest;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const recoveredId = tryExtractId(line);
          if (recoveredId !== undefined) {
            stdout.write(
              JSON.stringify(fail(recoveredId, PARSE_ERROR, "Parse error: " + message)) +
                "\n",
            );
          } else {
            process.stderr.write("JSON-RPC parse error: " + message + "\n");
          }
          continue;
        }

        const response = await handleRequest(req);
        stdout.write(JSON.stringify(response) + "\n");

        if (shutdownRequested || req.method === "shutdown") {
          break;
        }
      }
    } finally {
      rl.close();
    }
  }

  return { handleRequest, serve };
}

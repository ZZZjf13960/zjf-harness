import {
  canAutoRun,
  DEFAULT_PERMISSION_MODE,
  isHardDenied,
  parsePermissionMode,
  type PermissionMode,
  type ToolName,
} from "@zjf-harness/permissions";
import {
  get,
  getWorkspaceRoot,
  isWorkspaceRootSet,
  list,
  previewEdit,
  previewWrite,
  resetWorkspaceRoot,
  setWorkspaceRoot,
} from "@zjf-harness/tools";

export type { PermissionMode };
export { getWorkspaceRoot, setWorkspaceRoot, resetWorkspaceRoot };

export type ToolCallRequest = {
  id: string;
  name: string;
  arguments: unknown;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCallRequest[];
};

export type ModelTurn = {
  text: string;
  toolCalls: ToolCallRequest[];
};

export type LoopEvent =
  | { type: "assistant.delta"; text: string }
  | { type: "tool.start"; tool: string; id: string }
  | { type: "tool.end"; tool: string; id: string; ok: boolean }
  | { type: "turn.done" };

export type ModelClient = {
  complete(input: {
    messages: ChatMessage[];
    tools: {
      name: string;
      description: string;
      parameters?: Record<string, unknown>;
    }[];
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
  }): Promise<ModelTurn>;
};

export type Session = {
  mode: PermissionMode;
  sessionAllowed: Set<string>;
  messages: ChatMessage[];
  workspaceRoot?: string;
};

export function createSession(input?: {
  mode?: string;
  workspaceRoot?: string;
}): Session {
  const mode =
    input?.mode === undefined
      ? DEFAULT_PERMISSION_MODE
      : parsePermissionMode(input.mode);
  return {
    mode,
    sessionAllowed: new Set(),
    messages: [],
    workspaceRoot: input?.workspaceRoot,
  };
}

export type LoopResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  session: Session;
  gatedTool?: string;
};

const KNOWN_TOOLS: readonly ToolName[] = [
  "read",
  "write",
  "edit",
  "bash",
  "glob",
  "grep",
];

function asToolName(name: string): ToolName | undefined {
  return (KNOWN_TOOLS as readonly string[]).includes(name)
    ? (name as ToolName)
    : undefined;
}

const MAX_TURNS = 8;

export type ApprovalDecision = "allow" | "deny" | "allow-session" | "interrupt";

export async function runLoop(input: {
  session: Session;
  prompt: string;
  model: ModelClient;
  print?: boolean;
  maxTurns?: number;
  signal?: AbortSignal;
  workspaceRoot?: string;
  onApprove?: (gate: {
    tool: string;
    mode: PermissionMode;
    body?: string;
  }) => Promise<ApprovalDecision>;
  onEvent?: (event: LoopEvent) => void;
}): Promise<LoopResult> {
  const session = input.session;
  const print = input.print === true;
  const header = "mode=" + session.mode + " print=" + String(print) + "\n";
  session.messages.push({ role: "user", content: input.prompt });

  if (input.workspaceRoot) {
    setWorkspaceRoot(input.workspaceRoot);
  } else if (session.workspaceRoot) {
    setWorkspaceRoot(session.workspaceRoot);
  } else if (!isWorkspaceRootSet()) {
    setWorkspaceRoot(process.cwd());
  }

  const maxTurns = input.maxTurns ?? MAX_TURNS;
  for (let turn = 0; turn < maxTurns; turn++) {
    if (input.signal?.aborted) {
      return {
        exitCode: 1,
        stdout: header,
        stderr: "interrupted\n",
        session,
      };
    }
    const tools = list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
    const onEvent = input.onEvent;
    const reply = await input.model.complete({
      messages: session.messages,
      tools,
      signal: input.signal,
      onDelta: onEvent
        ? (text) => onEvent({ type: "assistant.delta", text })
        : undefined,
    });

    session.messages.push({
      role: "assistant",
      content: reply.text,
      toolCalls: reply.toolCalls.length > 0 ? reply.toolCalls : undefined,
    });

    if (reply.toolCalls.length === 0) {
      onEvent?.({ type: "turn.done" });
      let stdout = header + reply.text;
      if (reply.text && !reply.text.endsWith("\n")) {
        stdout += "\n";
      }
      return { exitCode: 0, stdout, stderr: "", session };
    }

    for (const call of reply.toolCalls) {
      const toolName = asToolName(call.name);

      if (isHardDenied(call.name, call.arguments)) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `Tool '${call.name}' is hard-denied (dangerous operation blocked).\n`,
          session,
          gatedTool: call.name,
        };
      }

      const allowed =
        toolName !== undefined &&
        canAutoRun(toolName, session.mode, {
          sessionAllowed: session.sessionAllowed,
          args: call.arguments,
        });
      if (!allowed) {
        const approve = input.onApprove;
        if (print || !approve) {
          let stderr =
            "Tool '" +
            call.name +
            "' requires approval in mode '" +
            session.mode +
            "'.";
          if (print) {
            stderr +=
              " Non-interactive print mode (-p) is fail-closed when approval is required.";
          }
          return {
            exitCode: 1,
            stdout: "",
            stderr: stderr + "\n",
            session,
            gatedTool: call.name,
          };
        }
        let body: string | undefined;
        if (call.name === "edit") {
          try {
            body = previewEdit(call.arguments);
          } catch {
            try {
              body = JSON.stringify(call.arguments ?? {});
            } catch {
              body = undefined;
            }
          }
        } else if (call.name === "write") {
          try {
            body = previewWrite(call.arguments);
          } catch {
            try {
              body = JSON.stringify(call.arguments ?? {});
            } catch {
              body = undefined;
            }
          }
        } else {
          try {
            body = JSON.stringify(call.arguments ?? {});
          } catch {
            body = undefined;
          }
        }
        const decision = await approve({
          tool: call.name,
          mode: session.mode,
          body,
        });
        if (decision === "interrupt") {
          return {
            exitCode: 1,
            stdout: header,
            stderr: "interrupted\n",
            session,
            gatedTool: call.name,
          };
        }
        if (decision === "deny") {
          session.messages.push({
            role: "tool",
            toolCallId: call.id,
            name: call.name,
            content: "User denied this tool call.",
          });
          continue;
        }
        if (decision === "allow-session") {
          session.sessionAllowed.add(call.name);
        }
      }

      const tool = get(call.name);
      let content: string;
      let ok = true;
      onEvent?.({ type: "tool.start", tool: call.name, id: call.id });
      try {
        if (!tool) {
          content = JSON.stringify({ error: "unknown tool: " + call.name });
        } else {
          const value = await tool.run(call.arguments);
          content = typeof value === "string" ? value : JSON.stringify(value);
        }
      } catch (err) {
        ok = false;
        content = err instanceof Error ? err.message : String(err);
      }
      onEvent?.({
        type: "tool.end",
        tool: call.name,
        id: call.id,
        ok,
      });
      session.messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content,
      });
    }
  }

  return {
    exitCode: 1,
    stdout: header,
    stderr: "Turn limit reached\n",
    session,
  };
}

export function missingApiKeyMessage(): string {
  return "Missing OPENAI_API_KEY. Set OPENAI_API_KEY (optional OPENAI_BASE_URL, OPENAI_MODEL) to run a live preview.\n";
}

/** Hard timeout for a single model.complete attempt (fetch + body/stream read). */
export const DEFAULT_MODEL_TIMEOUT_MS = 60_000;
/** Retries after the first attempt for HTTP 429 / 5xx only (total attempts = maxRetries + 1). */
export const DEFAULT_MODEL_MAX_RETRIES = 2;
/** Base delay for exponential backoff: delayMs = base * 2^attemptIndex. */
export const DEFAULT_MODEL_RETRY_BASE_DELAY_MS = 250;

export type CreateOpenAIClientOptions = {
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
};

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function mergeTimeoutSignal(
  caller: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; didTimeout: () => boolean; cleanup: () => void } {
  const timeoutController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort(
      new DOMException(
        `Model request timed out after ${timeoutMs}ms`,
        "TimeoutError",
      ),
    );
  }, timeoutMs);

  const cleanup = () => {
    clearTimeout(timer);
  };

  if (!caller) {
    return {
      signal: timeoutController.signal,
      didTimeout: () => timedOut,
      cleanup,
    };
  }

  if (typeof AbortSignal.any === "function") {
    return {
      signal: AbortSignal.any([caller, timeoutController.signal]),
      didTimeout: () => timedOut && !caller.aborted,
      cleanup,
    };
  }

  const merged = new AbortController();
  const forward = () => {
    if (merged.signal.aborted) return;
    if (caller.aborted) {
      merged.abort(caller.reason);
      return;
    }
    if (timeoutController.signal.aborted) {
      merged.abort(timeoutController.signal.reason);
    }
  };
  if (caller.aborted || timeoutController.signal.aborted) {
    forward();
  } else {
    caller.addEventListener("abort", forward, { once: true });
    timeoutController.signal.addEventListener("abort", forward, { once: true });
  }
  return {
    signal: merged.signal,
    didTimeout: () => timedOut && !caller.aborted,
    cleanup: () => {
      clearTimeout(timer);
      caller.removeEventListener("abort", forward);
      timeoutController.signal.removeEventListener("abort", forward);
    },
  };
}

export function createOpenAIClient(
  env: NodeJS.Dict<string> = process.env,
  options?: CreateOpenAIClientOptions,
): ModelClient {
  const apiKey = env.OPENAI_API_KEY;
  const baseUrl = (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const model = env.OPENAI_MODEL ?? "gpt-4o-mini";
  const timeoutMs = options?.timeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? DEFAULT_MODEL_MAX_RETRIES;
  const retryBaseDelayMs =
    options?.retryBaseDelayMs ?? DEFAULT_MODEL_RETRY_BASE_DELAY_MS;

  return {
    async complete(input) {
      if (!apiKey) {
        throw new Error(missingApiKeyMessage().trim());
      }
      const messages = input.messages.map((message) => {
        if (message.role === "tool") {
          return {
            role: "tool" as const,
            content: message.content,
            tool_call_id: message.toolCallId ?? "",
          };
        }
        if (message.role === "assistant" && message.toolCalls?.length) {
          return {
            role: "assistant" as const,
            content: message.content || null,
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments ?? {}),
              },
            })),
          };
        }
        return { role: message.role, content: message.content };
      });
      const tools = input.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters ?? {
            type: "object",
            additionalProperties: true,
          },
        },
      }));
      const stream = typeof input.onDelta === "function";
      const body: Record<string, unknown> = {
        model,
        messages,
        tools,
      };
      if (stream) {
        body.stream = true;
      }

      let lastError: Error | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (input.signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }

        const {
          signal,
          didTimeout,
          cleanup,
        } = mergeTimeoutSignal(input.signal, timeoutMs);

        try {
          const response = await fetch(baseUrl + "/chat/completions", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: "Bearer " + apiKey,
            },
            body: JSON.stringify(body),
            signal,
          });

          if (!response.ok) {
            const errText = await response.text().catch(() => "");
            const error = new Error(
              "Model request failed: " + response.status + " " + errText,
            );
            if (
              isRetryableStatus(response.status) &&
              attempt < maxRetries &&
              !input.signal?.aborted
            ) {
              lastError = error;
              await delay(retryBaseDelayMs * 2 ** attempt, input.signal);
              continue;
            }
            throw error;
          }

          if (!stream) {
            const json = (await response.json()) as {
              choices?: Array<{
                message?: {
                  content?: string | null;
                  tool_calls?: Array<{
                    id: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
              }>;
            };
            const message = json.choices?.[0]?.message;
            const toolCalls: ToolCallRequest[] = (message?.tool_calls ?? []).map(
              (call) => {
                let args: unknown = {};
                try {
                  args = JSON.parse(call.function?.arguments || "{}");
                } catch {
                  args = { raw: call.function?.arguments };
                }
                return {
                  id: call.id,
                  name: call.function?.name ?? "unknown",
                  arguments: args,
                };
              },
            );
            return { text: message?.content ?? "", toolCalls };
          }

          if (!response.body) {
            throw new Error(
              "Model request failed: missing response body for stream",
            );
          }

          type PartialToolCall = {
            id: string;
            name: string;
            arguments: string;
          };
          const toolAcc = new Map<number, PartialToolCall>();
          let text = "";
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          const flushLine = (line: string) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) return;
            if (!trimmed.startsWith("data:")) return;
            const data = trimmed.slice(5).trim();
            if (!data || data === "[DONE]") return;
            let parsed: {
              choices?: Array<{
                delta?: {
                  content?: string | null;
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
              }>;
            };
            try {
              parsed = JSON.parse(data);
            } catch {
              return;
            }
            const delta = parsed.choices?.[0]?.delta;
            if (!delta) return;
            if (typeof delta.content === "string" && delta.content.length > 0) {
              text += delta.content;
              input.onDelta?.(delta.content);
            }
            for (const part of delta.tool_calls ?? []) {
              const index = part.index ?? 0;
              const current = toolAcc.get(index) ?? {
                id: "",
                name: "",
                arguments: "",
              };
              if (part.id) current.id = part.id;
              if (part.function?.name) current.name = part.function.name;
              if (part.function?.arguments) {
                current.arguments += part.function.arguments;
              }
              toolAcc.set(index, current);
            }
          };

          while (true) {
            if (signal.aborted) {
              try {
                await reader.cancel();
              } catch {
                // ignore cancel errors
              }
              if (didTimeout()) {
                throw new Error(
                  `Model request timed out after ${timeoutMs}ms`,
                );
              }
              throw new DOMException(
                "The operation was aborted.",
                "AbortError",
              );
            }
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newline = buffer.indexOf("\n");
            while (newline >= 0) {
              const line = buffer.slice(0, newline);
              buffer = buffer.slice(newline + 1);
              flushLine(line);
              newline = buffer.indexOf("\n");
            }
          }
          if (buffer.trim()) {
            flushLine(buffer);
          }

          const toolCalls: ToolCallRequest[] = [...toolAcc.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, call]) => {
              let args: unknown = {};
              try {
                args = JSON.parse(call.arguments || "{}");
              } catch {
                args = { raw: call.arguments };
              }
              return {
                id: call.id || "tool_call",
                name: call.name || "unknown",
                arguments: args,
              };
            });
          return { text, toolCalls };
        } catch (err) {
          if (input.signal?.aborted) {
            throw isAbortError(err)
              ? err
              : new DOMException("The operation was aborted.", "AbortError");
          }
          if (didTimeout() || (isAbortError(err) && didTimeout())) {
            throw new Error(`Model request timed out after ${timeoutMs}ms`);
          }
          // Timeout may surface as AbortError from fetch before didTimeout is observed
          // on some runtimes; treat TimeoutError reason as timeout.
          const reason =
            err instanceof DOMException
              ? err
              : err instanceof Error
                ? err.cause
                : undefined;
          if (
            (err instanceof DOMException && err.name === "TimeoutError") ||
            (reason instanceof DOMException && reason.name === "TimeoutError") ||
            (err instanceof Error &&
              /timed out after \d+ms/.test(err.message))
          ) {
            throw err instanceof Error && /timed out after/.test(err.message)
              ? err
              : new Error(`Model request timed out after ${timeoutMs}ms`);
          }
          throw err;
        } finally {
          cleanup();
        }
      }

      throw lastError ?? new Error("Model request failed");
    },
  };
}

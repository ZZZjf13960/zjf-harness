import {
  canAutoRun,
  DEFAULT_PERMISSION_MODE,
  parsePermissionMode,
  type PermissionMode,
  type ToolName,
} from "@zjf-harness/permissions";
import { get, list } from "@zjf-harness/tools";

export type { PermissionMode };

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

export type ModelClient = {
  complete(input: {
    messages: ChatMessage[];
    tools: { name: string; description: string }[];
  }): Promise<ModelTurn>;
};

export type Session = {
  mode: PermissionMode;
  sessionAllowed: Set<string>;
  messages: ChatMessage[];
};

export function createSession(input?: { mode?: string }): Session {
  const mode =
    input?.mode === undefined
      ? DEFAULT_PERMISSION_MODE
      : parsePermissionMode(input.mode);
  return { mode, sessionAllowed: new Set(), messages: [] };
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

export async function runLoop(input: {
  session: Session;
  prompt: string;
  model: ModelClient;
  print?: boolean;
  maxTurns?: number;
}): Promise<LoopResult> {
  const session = input.session;
  const print = input.print === true;
  const header = "mode=" + session.mode + " print=" + String(print) + "\n";
  session.messages.push({ role: "user", content: input.prompt });

  const maxTurns = input.maxTurns ?? MAX_TURNS;
  for (let turn = 0; turn < maxTurns; turn++) {
    const tools = list().map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
    const reply = await input.model.complete({
      messages: session.messages,
      tools,
    });

    session.messages.push({
      role: "assistant",
      content: reply.text,
      toolCalls: reply.toolCalls.length > 0 ? reply.toolCalls : undefined,
    });

    if (reply.toolCalls.length === 0) {
      let stdout = header + reply.text;
      if (reply.text && !reply.text.endsWith("\n")) {
        stdout += "\n";
      }
      return { exitCode: 0, stdout, stderr: "", session };
    }

    for (const call of reply.toolCalls) {
      const toolName = asToolName(call.name);
      const allowed =
        toolName !== undefined &&
        canAutoRun(toolName, session.mode, {
          sessionAllowed: session.sessionAllowed,
        });
      if (!allowed) {
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

      const tool = get(call.name);
      let content: string;
      try {
        if (!tool) {
          content = JSON.stringify({ error: "unknown tool: " + call.name });
        } else {
          const value = await tool.run(call.arguments);
          content = typeof value === "string" ? value : JSON.stringify(value);
        }
      } catch (err) {
        content = err instanceof Error ? err.message : String(err);
      }
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

export function createOpenAIClient(
  env: NodeJS.Dict<string> = process.env,
): ModelClient {
  const apiKey = env.OPENAI_API_KEY;
  const baseUrl = (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const model = env.OPENAI_MODEL ?? "gpt-4o-mini";

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
      const body = {
        model,
        messages,
        tools: input.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: { type: "object", additionalProperties: true },
          },
        })),
      };
      const response = await fetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          "Model request failed: " + response.status + " " + errText,
        );
      }
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
    },
  };
}

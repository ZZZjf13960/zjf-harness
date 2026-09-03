import {
  canAutoRun,
  parsePermissionMode,
  type PermissionMode,
  type ToolName,
} from "@zjf-harness/permissions";

export type { PermissionMode };

export type SessionState = { mode: PermissionMode };

const MODE_COMMAND = /^\/mode\s+(\S+)\s*$/;

export function acceptPlan(input: { mode: string }): SessionState {
  parsePermissionMode(input.mode);
  return { mode: "accept-edits" };
}

export function applyModeCommand(command: string, input: { mode: string }): SessionState {
  parsePermissionMode(input.mode);
  const match = MODE_COMMAND.exec(command.trim());
  if (!match) {
    throw new Error("Unknown command: " + command + ". Use /mode plan|accept-edits|bypass");
  }
  return { mode: parsePermissionMode(match[1]) };
}

const CYCLE: PermissionMode[] = ["plan", "accept-edits", "bypass"];

export function cycleMode(input: { mode: string }): SessionState {
  const current = parsePermissionMode(input.mode);
  const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
  return { mode: next };
}

export function statusBar(mode: string): string {
  return parsePermissionMode(mode);
}

export function interruptTurn(): { interrupted: true } {
  return { interrupted: true };
}

const KNOWN_TOOLS: readonly ToolName[] = ["read", "write", "edit", "bash", "glob", "grep"];

function asTool(tool: string): ToolName | undefined {
  return (KNOWN_TOOLS as readonly string[]).includes(tool) ? (tool as ToolName) : undefined;
}

export type ApprovalAction = "allow" | "deny" | "allow-session";
export type ApprovalKey = "y" | "n" | "a" | "escape";

export type ApprovalCard = {
  tool: string;
  mode: PermissionMode;
  body: string;
  defaultAction: "allow" | "deny";
  actions: readonly ApprovalAction[];
};

export function presentApproval(input: {
  tool: string;
  mode: string;
  body?: string;
}): ApprovalCard | null {
  const mode = parsePermissionMode(input.mode);
  if (mode === "bypass") {
    return null;
  }
  const tool = asTool(input.tool);
  if (tool && canAutoRun(tool, mode)) {
    return null;
  }
  return {
    tool: input.tool,
    mode,
    body: input.body ?? "",
    defaultAction: mode === "plan" ? "deny" : "allow",
    actions: ["allow", "deny", "allow-session"],
  };
}

export function resolveApproval(
  card: ApprovalCard,
  key: ApprovalKey,
): { decision: ApprovalAction | "interrupt"; sessionTool?: string } {
  if (key === "escape") {
    return { decision: "interrupt" };
  }
  if (key === "n") {
    return { decision: "deny" };
  }
  if (key === "a") {
    return { decision: "allow-session", sessionTool: card.tool };
  }
  return { decision: "allow" };
}

export function renderApproval(card: ApprovalCard): string {
  const focus = card.defaultAction;
  const allow = focus === "allow" ? "[允许*]" : "[允许]";
  const deny = focus === "deny" ? "[拒绝*]" : "[拒绝]";
  return [
    "tool: " + card.tool,
    "mode: " + card.mode,
    card.body,
    allow + " " + deny + " [本会话允许该工具]",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export type LiveIO = {
  write(text: string): void;
  readKey(): Promise<string>;
};

export async function approveLive(
  gate: { tool: string; mode: string; body?: string },
  io: LiveIO,
): Promise<"allow" | "deny" | "allow-session" | "interrupt"> {
  const card = presentApproval(gate);
  if (!card) {
    return "allow";
  }
  io.write(renderApproval(card) + "\n");
  io.write("y allow / n deny / a session-allow / Esc interrupt\n");
  const raw = await io.readKey();
  const key: ApprovalKey =
    raw === "y" || raw === "n" || raw === "a" || raw === "escape" ? raw : "n";
  return resolveApproval(card, key).decision;
}

export type LiveLine =
  | { type: "mode"; mode: PermissionMode }
  | { type: "prompt"; text: string }
  | { type: "empty" };

export function handleLine(line: string, mode: string): LiveLine {
  const trimmed = line.trim();
  if (!trimmed) {
    return { type: "empty" };
  }
  if (trimmed.startsWith("/mode")) {
    return { type: "mode", mode: applyModeCommand(trimmed, { mode }).mode };
  }
  return { type: "prompt", text: trimmed };
}

export function liveBanner(mode: string): string {
  return statusBar(mode) + "\n";
}

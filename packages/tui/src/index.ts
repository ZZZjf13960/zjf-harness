import { parsePermissionMode, type PermissionMode } from "@zjf-harness/permissions";

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

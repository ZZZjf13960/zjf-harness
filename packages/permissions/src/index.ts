export type PermissionMode = "plan" | "accept-edits" | "bypass";

export const PERMISSION_MODES = ["plan", "accept-edits", "bypass"] as const;

export const DEFAULT_PERMISSION_MODE: PermissionMode = "plan";

export function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value);
}

export function parsePermissionMode(value: string | undefined): PermissionMode {
  if (value === undefined) {
    return DEFAULT_PERMISSION_MODE;
  }
  if (isPermissionMode(value)) {
    return value;
  }
  throw new Error(
    "Invalid permission mode: " + value + ". Legal values: " + PERMISSION_MODES.join(", "),
  );
}

export type ToolName = "read" | "write" | "edit" | "bash" | "glob" | "grep";

export type GatedReason = "ok" | "needs-approval";

const PLAN_AUTO: ReadonlySet<ToolName> = new Set(["read", "glob", "grep"]);
const ACCEPT_EDITS_AUTO: ReadonlySet<ToolName> = new Set([
  "read",
  "glob",
  "grep",
  "write",
  "edit",
]);

export function canAutoRun(
  tool: ToolName,
  mode: PermissionMode,
  opts?: { sessionAllowed?: ReadonlySet<string> },
): boolean {
  if (mode === "bypass") {
    return true;
  }
  if (mode === "plan") {
    // sessionAllowed does not apply in plan
    return PLAN_AUTO.has(tool);
  }
  if (ACCEPT_EDITS_AUTO.has(tool)) {
    return true;
  }
  return opts?.sessionAllowed?.has(tool) === true;
}

// MCP side-effect tools are not in ToolName yet.
export function canAutoRunMcp(sideEffect: boolean, mode: PermissionMode): boolean {
  if (!sideEffect) {
    return true;
  }
  return mode === "bypass";
}

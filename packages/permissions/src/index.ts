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

/**
 * Hard-denied dangerous bash command patterns.
 * Minimal security guardrail covering catastrophic operations.
 */
export const HARD_DENIED_BASH_PATTERNS: readonly RegExp[] = [
  // Dangerous root/system recursive deletions (e.g. rm -rf /, rm -fr /, rm -r -f /)
  /\brm\s+.*-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)\b.*(?:\s\/|\s~|\s\.\.|\s\*)/i,
  /\brm\s+.*-(?:r\s+-f|f\s+-r)\b.*(?:\s\/|\s~|\s\.\.|\s\*)/i,
  /\brm\s+.*--no-preserve-root/i,

  // Disk formatting and raw block writing
  /\bmkfs(?:\.[a-z0-9_-]+)?\b/i,
  /\bdd\s+.*(?:if=|of=)/i,

  // Fork bomb
  /: *\( *\) *\{ *[:|& ]+;? *\} *;? *:/,

  // System reboot / poweroff
  /\bshutdown\b/i,
  /\breboot\b/i,

  // Writing to /etc/ via common paths / redirects
  />\s*\/etc\b/i,
  />>\s*\/etc\b/i,
  /\btee\s+(?:-[a-zA-Z]+\s+)*\/etc\b/i,
  /\b(?:cp|mv|touch|install)\s+.*\/etc\b/i,
  /\bsed\s+.*-i.*\/etc\b/i,
];

function extractBashCommandString(args: unknown): string | undefined {
  if (typeof args === "string") {
    return args;
  }
  if (typeof args === "object" && args !== null) {
    const obj = args as Record<string, unknown>;
    if (typeof obj.command === "string") return obj.command;
    if (typeof obj.cmd === "string") return obj.cmd;
  }
  return undefined;
}

export function isHardDenied(tool: string, args?: unknown): boolean {
  if (tool === "bash") {
    const cmd = extractBashCommandString(args);
    if (!cmd) return false;
    return HARD_DENIED_BASH_PATTERNS.some((pattern) => pattern.test(cmd));
  }
  if (tool === "write" || tool === "edit") {
    let targetPath: string | undefined;
    if (typeof args === "string") {
      targetPath = args;
    } else if (typeof args === "object" && args !== null) {
      const obj = args as Record<string, unknown>;
      targetPath = (obj.path ?? obj.filePath ?? obj.file) as string | undefined;
    }
    if (typeof targetPath === "string") {
      const normalized = targetPath.replace(/\\/g, "/");
      if (normalized === "/etc" || normalized.startsWith("/etc/")) {
        return true;
      }
    }
  }
  return false;
}

export function canAutoRun(
  tool: ToolName,
  mode: PermissionMode,
  opts?: { sessionAllowed?: ReadonlySet<string>; args?: unknown } | unknown,
): boolean {
  let sessionAllowed: ReadonlySet<string> | undefined;
  let args: unknown;

  if (typeof opts === "object" && opts !== null) {
    if ("sessionAllowed" in opts || "args" in opts) {
      const o = opts as { sessionAllowed?: ReadonlySet<string>; args?: unknown };
      sessionAllowed = o.sessionAllowed;
      args = o.args;
    } else {
      args = opts;
    }
  } else {
    args = opts;
  }

  if (isHardDenied(tool, args)) {
    return false;
  }

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
  return sessionAllowed?.has(tool) === true;
}

// MCP side-effect tools are not in ToolName yet. Hard deny hook can be added when MCP side-effect tools are integrated.
export function canAutoRunMcp(sideEffect: boolean, mode: PermissionMode): boolean {
  if (!sideEffect) {
    return true;
  }
  return mode === "bypass";
}

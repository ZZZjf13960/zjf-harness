import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  parsePermissionMode,
  type PermissionMode,
} from "@zjf-harness/permissions";

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

function usage(): string {
  return [
    "Usage: zjf-harness [options]",
    "",
    "Options:",
    "  --mode <mode>   Permission mode: plan | accept-edits | bypass (default: plan)",
    "  -p, --print     Non-interactive print mode (does not change permission mode)",
    "  -h, --help      Show this help",
  ].join("\n") + "\n";
}

export function runCli(argv: string[]): CliResult {
  let modeRaw: string | undefined;
  let modeProvided = false;
  let print = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "-p" || arg === "--print") {
      print = true;
      continue;
    }
    if (arg === "--mode") {
      modeProvided = true;
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        return {
          exitCode: 1,
          stdout: "",
          stderr:
            "Missing value for --mode. Legal values: " +
            PERMISSION_MODES.join(", ") +
            "\n",
        };
      }
      modeRaw = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      modeProvided = true;
      modeRaw = arg.slice("--mode=".length);
    }
  }

  if (help) {
    return { exitCode: 0, stdout: usage(), stderr: "" };
  }

  let mode: PermissionMode;
  if (!modeProvided) {
    mode = DEFAULT_PERMISSION_MODE;
  } else {
    try {
      mode = parsePermissionMode(modeRaw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { exitCode: 1, stdout: "", stderr: message + "\n" };
    }
  }

  return {
    exitCode: 0,
    stdout: "mode=" + mode + " print=" + String(print) + "\n",
    stderr: "",
  };
}

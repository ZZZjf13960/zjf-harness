import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  parsePermissionMode,
  canAutoRun,
  type PermissionMode,
  type ToolName,
} from "@zjf-harness/permissions";
import { writeSync, editSync, bashSync } from "@zjf-harness/tools";

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
    "  --write <path>  Request write of 'after\\n' to path",
    "  --edit <path>   Request edit of 'after\\n' to path",
    "  --bash <cmd>    Request bash execution of command",
    "  -h, --help      Show this help",
  ].join("\n") + "\n";
}

export function runCli(argv: string[]): CliResult {
  let modeRaw: string | undefined;
  let modeProvided = false;
  let print = false;
  let help = false;
  let requestedTool: ToolName | undefined;
  let targetPath: string | undefined;
  let bashCommand: string | undefined;

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
      continue;
    }
    if (arg === "--write") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --write\n",
        };
      }
      requestedTool = "write";
      targetPath = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--write=")) {
      requestedTool = "write";
      targetPath = arg.slice("--write=".length);
      if (!targetPath) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --write\n",
        };
      }
      continue;
    }
    if (arg === "--edit") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --edit\n",
        };
      }
      requestedTool = "edit";
      targetPath = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--edit=")) {
      requestedTool = "edit";
      targetPath = arg.slice("--edit=".length);
      if (!targetPath) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --edit\n",
        };
      }
      continue;
    }
    if (arg === "--bash") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --bash\n",
        };
      }
      requestedTool = "bash";
      bashCommand = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--bash=")) {
      requestedTool = "bash";
      bashCommand = arg.slice("--bash=".length);
      if (!bashCommand) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --bash\n",
        };
      }
      continue;
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

  if (requestedTool) {
    const allowed = canAutoRun(requestedTool, mode);
    if (!allowed) {
      let stderrMsg = `Tool '${requestedTool}' requires approval in mode '${mode}'.`;
      if (print) {
        stderrMsg += " Non-interactive print mode (-p) is fail-closed when approval is required.";
      }
      return {
        exitCode: 1,
        stdout: "",
        stderr: stderrMsg + "\n",
      };
    }

    if (requestedTool === "write" || requestedTool === "edit") {
      if (!targetPath) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `Missing target path for ${requestedTool}\n`,
        };
      }
      try {
        if (requestedTool === "write") {
          writeSync(targetPath);
        } else {
          editSync(targetPath);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exitCode: 1, stdout: "", stderr: message + "\n" };
      }
    } else if (requestedTool === "bash") {
      if (bashCommand === undefined) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --bash\n",
        };
      }
      try {
        const res = bashSync(bashCommand);
        let out = "mode=" + mode + " print=" + String(print) + "\n";
        if (res.stdout) {
          out += res.stdout;
        }
        return {
          exitCode: res.exitCode,
          stdout: out,
          stderr: res.stderr,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          exitCode: 1,
          stdout: "mode=" + mode + " print=" + String(print) + "\n",
          stderr: message + "\n",
        };
      }
    }
  }

  return {
    exitCode: 0,
    stdout: "mode=" + mode + " print=" + String(print) + "\n",
    stderr: "",
  };
}

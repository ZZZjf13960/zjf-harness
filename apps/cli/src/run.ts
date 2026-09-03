import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODES,
  parsePermissionMode,
  canAutoRun,
  type PermissionMode,
  type ToolName,
} from "@zjf-harness/permissions";
import {
  writeSync,
  editSync,
  bashSync,
  readSync,
  globSync,
  grepSync,
} from "@zjf-harness/tools";
import {
  createOpenAIClient,
  createSession,
  runLoop,
  type ModelClient,
} from "@zjf-harness/core";
import { approveLive, handleLine, liveBanner } from "@zjf-harness/tui";
import readline from "node:readline";

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
    "  --read <path>   Request read of file at path",
    "  --write <path>  Request write of 'after\\n' to path",
    "  --edit <path>   Request edit of 'after\\n' to path",
    "  --bash <cmd>    Request bash execution of command",
    "  --glob <pat>    Request glob matching of pattern",
    "  --grep <pat>    Request grep search of pattern",
    "  --path <path>   Optional path for grep/glob (default: cwd)",
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
  let globPattern: string | undefined;
  let grepPattern: string | undefined;
  let customPath: string | undefined;

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
    if (arg === "--read") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --read\n",
        };
      }
      requestedTool = "read";
      targetPath = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--read=")) {
      requestedTool = "read";
      targetPath = arg.slice("--read=".length);
      if (!targetPath) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --read\n",
        };
      }
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
    if (arg === "--glob") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --glob\n",
        };
      }
      requestedTool = "glob";
      globPattern = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--glob=")) {
      requestedTool = "glob";
      globPattern = arg.slice("--glob=".length);
      if (!globPattern) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --glob\n",
        };
      }
      continue;
    }
    if (arg === "--grep") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --grep\n",
        };
      }
      requestedTool = "grep";
      grepPattern = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--grep=")) {
      requestedTool = "grep";
      grepPattern = arg.slice("--grep=".length);
      if (!grepPattern) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --grep\n",
        };
      }
      continue;
    }
    if (arg === "--path") {
      const next = argv[i + 1];
      if (!next || next.startsWith("-")) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --path\n",
        };
      }
      customPath = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--path=")) {
      customPath = arg.slice("--path=".length);
      if (!customPath) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing value for --path\n",
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
    } else if (requestedTool === "read") {
      if (!targetPath) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing target path for read\n",
        };
      }
      try {
        const content = readSync(targetPath);
        let out = "mode=" + mode + " print=" + String(print) + "\n";
        if (content) {
          out += content;
        }
        return {
          exitCode: 0,
          stdout: out,
          stderr: "",
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exitCode: 1, stdout: "", stderr: message + "\n" };
      }
    } else if (requestedTool === "glob") {
      if (!globPattern) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing pattern for glob\n",
        };
      }
      try {
        const matches = globSync({ pattern: globPattern, cwd: customPath });
        let out = "mode=" + mode + " print=" + String(print) + "\n";
        if (matches.length > 0) {
          out += matches.join("\n") + "\n";
        }
        return {
          exitCode: 0,
          stdout: out,
          stderr: "",
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exitCode: 1, stdout: "", stderr: message + "\n" };
      }
    } else if (requestedTool === "grep") {
      if (!grepPattern) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "Missing pattern for grep\n",
        };
      }
      try {
        const matches = grepSync({ pattern: grepPattern, path: customPath });
        let out = "mode=" + mode + " print=" + String(print) + "\n";
        if (matches.length > 0) {
          out += matches.join("\n") + "\n";
        }
        return {
          exitCode: 0,
          stdout: out,
          stderr: "",
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exitCode: 1, stdout: "", stderr: message + "\n" };
      }
    }
  }

  return {
    exitCode: 0,
    stdout: "mode=" + mode + " print=" + String(print) + "\n",
    stderr: "",
  };
}

function withoutPrompt(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--mode" || arg === "--write" || arg === "--edit" || arg === "--bash" || arg === "--read" || arg === "--glob" || arg === "--grep" || arg === "--path") {
      out.push(arg);
      const next = argv[i + 1];
      if (next !== undefined) {
        out.push(next);
        i += 1;
      }
      continue;
    }
    if (arg.startsWith("-")) {
      out.push(arg);
    }
  }
  return out;
}

export function previewPrompt(argv: string[]): string | undefined {
  const parts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--mode" || arg === "--write" || arg === "--edit" || arg === "--bash" || arg === "--read" || arg === "--glob" || arg === "--grep" || arg === "--path") {
      i += 1;
      continue;
    }
    if (
      arg.startsWith("--mode=") ||
      arg.startsWith("--write=") ||
      arg.startsWith("--edit=") ||
      arg.startsWith("--bash=") ||
      arg.startsWith("--read=") ||
      arg.startsWith("--glob=") ||
      arg.startsWith("--grep=") ||
      arg.startsWith("--path=")
    ) {
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    parts.push(arg);
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export function isOneShotTool(argv: string[]): boolean {
  return argv.some(
    (arg) =>
      arg === "--write" ||
      arg === "--edit" ||
      arg === "--bash" ||
      arg === "--read" ||
      arg === "--glob" ||
      arg === "--grep" ||
      arg.startsWith("--write=") ||
      arg.startsWith("--edit=") ||
      arg.startsWith("--bash=") ||
      arg.startsWith("--read=") ||
      arg.startsWith("--glob=") ||
      arg.startsWith("--grep="),
  );
}

export function shouldRunPreview(argv: string[]): boolean {
  if (isOneShotTool(argv)) return false;
  if (argv.includes("-h") || argv.includes("--help")) return false;
  return previewPrompt(argv) !== undefined;
}

export async function runPreview(
  argv: string[],
  model?: ModelClient,
  io?: {
    interactive?: boolean;
    write?: (text: string) => void;
    readKey?: () => Promise<string>;
    readLine?: () => Promise<string | undefined>;
  },
): Promise<CliResult> {
  const parsed = runCli(withoutPrompt(argv));
  if (parsed.exitCode !== 0) {
    return parsed;
  }
  let prompt = previewPrompt(argv);
  if (!prompt) {
    return parsed;
  }
  const mode = parsed.stdout.match(/mode=(\S+)/)?.[1] ?? "plan";
  const print = /print=true/.test(parsed.stdout);
  const interactive = !print && (io?.interactive ?? Boolean(process.stdin.isTTY));
  const write = io?.write ?? ((text: string) => {
    process.stdout.write(text);
  });
  const readKey =
    io?.readKey ??
    (async () => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const line = await new Promise<string>((resolve) =>
        rl.question("approve> ", resolve),
      );
      rl.close();
      const t = line.trim().toLowerCase();
      if (t === "esc" || t === "escape") return "escape";
      return t[0] ?? "n";
    });
  const readLine =
    io?.readLine ??
    (interactive
      ? async () => {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const line = await new Promise<string>((resolve) =>
            rl.question("> ", resolve),
          );
          rl.close();
          return line;
        }
      : undefined);
  const client = model ?? createOpenAIClient();
  const session = createSession({ mode });
  if (interactive) {
    write(liveBanner(session.mode));
  }

  async function once(text: string): Promise<CliResult> {
    const result = await runLoop({
      session,
      prompt: text,
      print,
      model: client,
      onApprove:
        interactive
          ? (gate) => approveLive(gate, { write, readKey })
          : undefined,
    });
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  try {
    let last = await once(prompt);
    if (!interactive || !readLine) {
      return last;
    }
    write(last.stdout);
    if (last.stderr) write(last.stderr);
    while (true) {
      write(liveBanner(session.mode));
      const line = await readLine();
      if (line === undefined || line.trim() === "") {
        return { exitCode: last.exitCode, stdout: "", stderr: "" };
      }
      const handled = handleLine(line, session.mode);
      if (handled.type === "empty") {
        return { exitCode: last.exitCode, stdout: "", stderr: "" };
      }
      if (handled.type === "mode") {
        session.mode = handled.mode;
        write("mode=" + session.mode + "\n");
        continue;
      }
      last = await once(handled.text);
      write(last.stdout);
      if (last.stderr) write(last.stderr);
      if (last.stderr.includes("interrupted")) {
        return { exitCode: last.exitCode, stdout: "", stderr: "" };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      stdout: "",
      stderr: message.endsWith("\n") ? message : message + "\n",
    };
  }
}

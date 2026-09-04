import readline from "node:readline";
import {
  canAutoRun,
  type PermissionMode,
  type ToolName,
} from "@zjf-harness/permissions";

type InputStream = NodeJS.ReadStream;
type OutputStream = NodeJS.WriteStream;

export type TuiInputEvent =
  | { type: "submit"; text: string }
  | { type: "mode"; mode: PermissionMode }
  | { type: "exit" };

export type TuiMessageRole = "user" | "assistant" | "system";
type ApprovalDecision = "allow" | "deny" | "allow-session" | "interrupt";
type ApprovalCard = {
  tool: string;
  mode: PermissionMode;
  body: string;
};

type Key = {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  sequence?: string;
  code?: string;
};

const ESC = "\u001b[";
const RESET = ESC + "0m";
const DIM = ESC + "2m";
const BOLD = ESC + "1m";
const CYAN = ESC + "36m";
const YELLOW = ESC + "33m";
const RED = ESC + "31m";
const GREEN = ESC + "32m";

function visibleLength(value: string): number {
  return value.replace(/\u001b\[[0-9;]*m/g, "").length;
}

function pad(value: string, width: number): string {
  return value + " ".repeat(Math.max(0, width - visibleLength(value)));
}

function crop(value: string, width: number): string {
  if (width <= 0) return "";
  if (visibleLength(value) <= width) return value;
  const plain = value.replace(/\u001b\[[0-9;]*m/g, "");
  return plain.slice(0, Math.max(0, width - 1)) + "…";
}

function wrap(value: string, width: number): string[] {
  const lines: string[] = [];
  for (const source of value.split(/\r?\n/)) {
    if (!source) {
      lines.push("");
      continue;
    }
    for (let offset = 0; offset < source.length; offset += width) {
      lines.push(source.slice(offset, offset + width));
    }
  }
  return lines;
}

function modeColor(mode: PermissionMode): string {
  if (mode === "bypass") return RED + BOLD;
  if (mode === "accept-edits") return YELLOW;
  return CYAN;
}

function modeDescription(mode: PermissionMode): string {
  if (mode === "bypass") return "all registered tools run automatically";
  if (mode === "accept-edits") return "file edits run automatically; commands ask";
  return "read-only tools run automatically; changes ask";
}

const MODES: PermissionMode[] = ["plan", "accept-edits", "bypass"];
const TOOLS: readonly ToolName[] = [
  "read",
  "write",
  "edit",
  "bash",
  "glob",
  "grep",
];

function nextMode(mode: PermissionMode): PermissionMode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length]!;
}

export type NativeTerminalOptions = {
  input?: InputStream;
  output?: OutputStream;
};

export class NativeTerminalTui {
  private readonly input: InputStream;
  private readonly output: OutputStream;
  private mode: PermissionMode = "plan";
  private line = "";
  private busy = false;
  private opened = false;
  private messages: Array<{ role: TuiMessageRole; text: string }> = [];
  private approval?: ApprovalCard;
  private inputResolve?: (event: TuiInputEvent) => void;
  private approvalResolve?: (decision: ApprovalDecision) => void;
  private interrupt?: () => void;

  constructor(options: NativeTerminalOptions = {}) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
  }

  open(mode: PermissionMode): void {
    if (this.opened) return;
    this.opened = true;
    this.mode = mode;
    readline.emitKeypressEvents(this.input);
    this.input.on("keypress", this.onKeypress);
    this.output.on("resize", this.onResize);
    if (this.input.isTTY) {
      this.input.setRawMode(true);
    }
    this.input.resume();
    this.output.write("\u001b[?1049h\u001b[?25h");
    this.render();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.input.off("keypress", this.onKeypress);
    this.output.off("resize", this.onResize);
    if (this.input.isTTY) {
      this.input.setRawMode(false);
    }
    this.input.pause();
    this.output.write("\u001b[?25h\u001b[?1049l");
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode;
    this.render();
  }

  addMessage(role: TuiMessageRole, text: string): void {
    const clean = text.trim();
    if (!clean) return;
    this.messages.push({ role, text: clean });
    this.render();
  }

  setBusy(busy: boolean, interrupt?: () => void): void {
    this.busy = busy;
    this.interrupt = busy ? interrupt : undefined;
    this.render();
  }

  readInput(): Promise<TuiInputEvent> {
    this.line = "";
    this.render();
    return new Promise((resolve) => {
      this.inputResolve = resolve;
    });
  }

  approve(input: {
    tool: string;
    mode: PermissionMode;
    body?: string;
  }): Promise<ApprovalDecision> {
    const tool = TOOLS.includes(input.tool as ToolName)
      ? (input.tool as ToolName)
      : undefined;
    if (
      input.mode === "bypass" ||
      (tool !== undefined && canAutoRun(tool, input.mode))
    ) {
      return Promise.resolve("allow");
    }
    this.approval = {
      tool: input.tool,
      mode: input.mode,
      body: input.body ?? "",
    };
    this.render();
    return new Promise((resolve) => {
      this.approvalResolve = resolve;
    });
  }

  private finishInput(event: TuiInputEvent): void {
    const resolve = this.inputResolve;
    this.inputResolve = undefined;
    resolve?.(event);
  }

  private finishApproval(decision: ApprovalDecision): void {
    const resolve = this.approvalResolve;
    this.approvalResolve = undefined;
    this.approval = undefined;
    this.render();
    resolve?.(decision);
  }

  private readonly onResize = (): void => {
    this.render();
  };

  private readonly onKeypress = (text: string, key: Key): void => {
    const isInterrupt =
      key.name === "escape" || (key.ctrl === true && key.name === "c");

    if (this.approval) {
      if (isInterrupt) {
        this.finishApproval("interrupt");
      } else if (text === "y") {
        this.finishApproval("allow");
      } else if (text === "n") {
        this.finishApproval("deny");
      } else if (text === "a") {
        this.finishApproval("allow-session");
      }
      return;
    }

    if (this.busy) {
      if (isInterrupt) this.interrupt?.();
      return;
    }

    if (!this.inputResolve) return;
    if (isInterrupt) {
      this.finishInput({ type: "exit" });
      return;
    }
    if (
      (key.name === "tab" && key.shift === true) ||
      key.name === "backtab" ||
      key.sequence === "\u001b[Z" ||
      key.sequence === "\u001b[9;2u"
    ) {
      const next = nextMode(this.mode);
      this.mode = next;
      this.line = "";
      this.render();
      this.finishInput({ type: "mode", mode: next });
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      const value = this.line.trim();
      this.line = "";
      if (!value) {
        this.finishInput({ type: "exit" });
      } else {
        this.finishInput({ type: "submit", text: value });
      }
      return;
    }
    if (key.name === "backspace" || key.name === "delete") {
      this.line = this.line.slice(0, -1);
      this.render();
      return;
    }
    if (
      text &&
      key.ctrl !== true &&
      key.meta !== true &&
      !/[\u0000-\u001f\u007f]/.test(text)
    ) {
      this.line += text;
      this.render();
    }
  };

  private render(): void {
    if (!this.opened) return;
    const columns = Math.max(40, this.output.columns || 80);
    const rows = Math.max(12, this.output.rows || 24);
    const inner = columns - 2;
    const transcriptRows = Math.max(4, rows - 8);
    const history: string[] = [];

    for (const message of this.messages) {
      const label =
        message.role === "user"
          ? GREEN + "you" + RESET
          : message.role === "assistant"
            ? CYAN + "assistant" + RESET
            : YELLOW + "system" + RESET;
      const lines = wrap(message.text, Math.max(10, inner - 10));
      history.push(" " + label + "  " + (lines.shift() ?? ""));
      for (const line of lines) history.push("      " + line);
      history.push("");
    }

    if (this.approval) {
      history.push(YELLOW + BOLD + " Approval required" + RESET);
      history.push(" tool: " + this.approval.tool);
      history.push(" mode: " + this.approval.mode);
      for (const line of wrap(this.approval.body, Math.max(10, inner - 2))) {
        history.push(" " + line);
      }
      history.push("");
      history.push(" y allow   n deny   a allow for session   Esc interrupt");
    } else if (this.busy) {
      history.push(CYAN + " assistant is working…" + RESET);
      history.push(DIM + " Esc interrupts the current turn" + RESET);
    }

    const visible = history.slice(-transcriptRows);
    while (visible.length < transcriptRows) visible.unshift("");

    const title = " zjf-harness ";
    const top = "┌" + title + "─".repeat(Math.max(0, inner - title.length)) + "┐";
    const body = visible.map(
      (line) => "│" + pad(crop(line, inner), inner) + "│",
    );
    const split = "├" + "─".repeat(inner) + "┤";
    const status =
      " " +
      modeColor(this.mode) +
      this.mode +
      RESET +
      DIM +
      "  " +
      modeDescription(this.mode) +
      RESET;
    const help = DIM + " Shift+Tab mode  /mode <name>  Esc exit" + RESET;
    const prompt = this.approval
      ? DIM + " approval> " + RESET
      : this.busy
        ? DIM + " waiting for model…" + RESET
        : CYAN + " > " + RESET + this.line;
    const bottom = "└" + "─".repeat(inner) + "┘";

    this.output.write(
      "\u001b[2J\u001b[H" +
        [top, ...body, split, "│" + pad(crop(status, inner), inner) + "│",
          "│" + pad(crop(help, inner), inner) + "│",
          "│" + pad(crop(prompt, inner), inner) + "│", bottom].join("\n"),
    );
  }
}

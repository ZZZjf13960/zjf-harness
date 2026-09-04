import { describe, expect, it } from "vitest";
import {
  runPreview,
  runTui,
  shouldRunTui,
  type TerminalUi,
} from "./run";
import type { ModelClient, ModelTurn } from "@zjf-harness/core";
import type {
  ApprovalDecision,
  PermissionMode,
  TuiInputEvent,
} from "@zjf-harness/tui";

function fakeModel(turns: ModelTurn[]): ModelClient {
  let i = 0;
  return {
    async complete() {
      const turn = turns[Math.min(i, turns.length - 1)]!;
      i += 1;
      return turn;
    },
  };
}

describe("TTY session", () => {
  it("slash mode then a follow-up, empty line ends", async () => {
    const lines = ["/mode accept-edits", "second prompt", ""];
    const writes: string[] = [];
    const result = await runPreview(
      ["first prompt"],
      fakeModel([
        { text: "first", toolCalls: [] },
        { text: "second", toolCalls: [] },
      ]),
      {
        interactive: true,
        write: (t) => writes.push(t),
        readKey: async () => "n",
        readLine: async () => lines.shift(),
      },
    );
    expect(result.exitCode).toBe(0);
    const out = writes.join("");
    expect(out).toMatch(/first/);
    expect(out).toMatch(/accept-edits/);
    expect(out).toMatch(/second/);
  });

  it("opens the native TUI without a positional prompt", () => {
    expect(shouldRunTui([], true)).toBe(true);
    expect(shouldRunTui(["--mode", "accept-edits"], true)).toBe(true);
    expect(shouldRunTui([], false)).toBe(false);
    expect(shouldRunTui(["-p"], true)).toBe(false);
    expect(shouldRunTui(["--help"], true)).toBe(false);
    expect(shouldRunTui(["--read", "README.md"], true)).toBe(false);
  });

  it("runs prompts and mode changes through the terminal UI", async () => {
    class FakeUi implements TerminalUi {
      events: TuiInputEvent[] = [
        { type: "mode", mode: "accept-edits" },
        { type: "submit", text: "hello tui" },
        { type: "exit" },
      ];
      messages: Array<{ role: string; text: string }> = [];
      modes: PermissionMode[] = [];
      opened = false;
      closed = false;

      open(mode: PermissionMode) {
        this.opened = true;
        this.modes.push(mode);
      }
      close() {
        this.closed = true;
      }
      setMode(mode: PermissionMode) {
        this.modes.push(mode);
      }
      addMessage(role: "user" | "assistant" | "system", text: string) {
        this.messages.push({ role, text });
      }
      setBusy() {}
      async readInput() {
        return this.events.shift() ?? { type: "exit" as const };
      }
      async approve(): Promise<ApprovalDecision> {
        return "deny";
      }
    }

    const ui = new FakeUi();
    const result = await runTui(
      [],
      fakeModel([{ text: "hello from the model", toolCalls: [] }]),
      ui,
    );

    expect(result.exitCode).toBe(0);
    expect(ui.opened).toBe(true);
    expect(ui.closed).toBe(true);
    expect(ui.modes).toEqual(["plan", "accept-edits"]);
    expect(ui.messages).toContainEqual({ role: "user", text: "hello tui" });
    expect(ui.messages).toContainEqual({
      role: "assistant",
      text: "hello from the model",
    });
  });
});

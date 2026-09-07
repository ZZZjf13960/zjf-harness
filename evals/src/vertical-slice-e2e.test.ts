import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { createSession, runLoop, resetWorkspaceRoot } from "@zjf-harness/core";
import {
  acceptPlan,
  cycleMode,
  handleLine,
  presentApproval,
  renderApproval,
} from "@zjf-harness/tui";

function editThenText(file: string, oldText: string, newText: string) {
  let n = 0;
  return {
    complete: async () => {
      n += 1;
      if (n === 1) {
        return {
          text: "",
          toolCalls: [
            {
              id: "edit-1",
              name: "edit",
              arguments: { path: file, oldText, newText },
            },
          ],
        };
      }
      return { text: "done", toolCalls: [] };
    },
  };
}

describe("vertical slice e2e", () => {
  afterEach(() => {
    resetWorkspaceRoot();
  });

  it("edit approval body is a unified diff and deny does not land", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zjf-e2e-"));
    const file = path.join(dir, "note.txt");
    await writeFile(file, "hello" + String.fromCharCode(10));
    let body = "";
    const session = createSession({ mode: "plan", workspaceRoot: dir });
    const r = await runLoop({
      session,
      prompt: "edit the note",
      model: editThenText(file, "hello" + String.fromCharCode(10), "hello world" + String.fromCharCode(10)),
      onApprove: async (gate) => {
        body = gate.body ?? "";
        expect(gate.tool).toBe("edit");
        return "deny";
      },
    });
    expect(body).toMatch(/--- /);
    expect(body).toMatch(/\+\+\+ /);
    expect(body).toMatch(/-hello/);
    expect(body).toMatch(/\+hello world/);
    const card = presentApproval({ tool: "edit", mode: "plan", body });
    expect(card).not.toBeNull();
    expect(renderApproval(card!)).toMatch(/\+hello world/);
    expect(await readFile(file, "utf8")).toBe("hello" + String.fromCharCode(10));
    expect(r.exitCode).toBe(0);
  });

  it("Esc interrupt from onApprove does not land the edit", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zjf-e2e-"));
    const file = path.join(dir, "note.txt");
    await writeFile(file, "hello" + String.fromCharCode(10));
    const session = createSession({ mode: "plan", workspaceRoot: dir });
    const r = await runLoop({
      session,
      prompt: "edit the note",
      model: editThenText(file, "hello" + String.fromCharCode(10), "bye" + String.fromCharCode(10)),
      onApprove: async () => "interrupt",
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/interrupted/);
    expect(await readFile(file, "utf8")).toBe("hello" + String.fromCharCode(10));
  });

  it("AbortSignal mid-loop surfaces interrupted", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zjf-e2e-"));
    const file = path.join(dir, "note.txt");
    await writeFile(file, "hello" + String.fromCharCode(10));
    const controller = new AbortController();
    const session = createSession({ mode: "plan", workspaceRoot: dir });
    let n = 0;
    const model = {
      complete: async () => {
        n += 1;
        if (n === 1) {
          controller.abort();
          return {
            text: "",
            toolCalls: [{ id: "1", name: "read", arguments: { path: file } }],
          };
        }
        return { text: "should not run", toolCalls: [] };
      },
    };
    const r = await runLoop({
      session,
      prompt: "hi",
      model,
      signal: controller.signal,
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/interrupted/);
  });

  it("/accept switches to accept-edits; /keep stays plan without writing", () => {
    expect(handleLine("/accept", "plan")).toEqual({ type: "accept-plan" });
    expect(acceptPlan({ mode: "plan" }).mode).toBe("accept-edits");
    expect(handleLine("/keep", "plan")).toEqual({ type: "keep-plan" });
  });

  it("Shift+Tab equivalent cycles plan to accept-edits to bypass", () => {
    expect(cycleMode({ mode: "plan" }).mode).toBe("accept-edits");
    expect(cycleMode({ mode: "accept-edits" }).mode).toBe("bypass");
    expect(cycleMode({ mode: "bypass" }).mode).toBe("plan");
  });
});


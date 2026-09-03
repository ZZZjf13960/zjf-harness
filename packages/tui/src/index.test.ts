import { describe, expect, it } from "vitest";
import {
  acceptPlan,
  applyModeCommand,
  cycleMode,
  interruptTurn,
  presentApproval,
  renderApproval,
  resolveApproval,
  statusBar,
  handleLine,
  approveLive,
} from "./index";

describe("acceptPlan", () => {
  it("switches plan to accept-edits", () => {
    expect(acceptPlan({ mode: "plan" }).mode).toBe("accept-edits");
  });

  it("rejects an illegal current mode", () => {
    expect(() => acceptPlan({ mode: "full-auto" })).toThrow(/Invalid permission mode/);
  });
});

describe("applyModeCommand", () => {
  it("applies /mode accept-edits", () => {
    expect(applyModeCommand("/mode accept-edits", { mode: "plan" }).mode).toBe("accept-edits");
  });

  it("applies /mode plan and /mode bypass", () => {
    expect(applyModeCommand("/mode plan", { mode: "bypass" }).mode).toBe("plan");
    expect(applyModeCommand("/mode bypass", { mode: "plan" }).mode).toBe("bypass");
  });

  it("rejects unknown slash commands", () => {
    expect(() => applyModeCommand("/nope", { mode: "plan" })).toThrow(/Unknown command/);
  });

  it("rejects illegal mode values", () => {
    expect(() => applyModeCommand("/mode full-auto", { mode: "plan" })).toThrow(
      /Invalid permission mode/,
    );
  });
});

describe("cycleMode", () => {
  it("cycles plan -> accept-edits -> bypass -> plan", () => {
    expect(cycleMode({ mode: "plan" }).mode).toBe("accept-edits");
    expect(cycleMode({ mode: "accept-edits" }).mode).toBe("bypass");
    expect(cycleMode({ mode: "bypass" }).mode).toBe("plan");
  });
});

describe("statusBar", () => {
  it("shows the wire name untranslated", () => {
    expect(statusBar("plan")).toBe("plan");
    expect(statusBar("accept-edits")).toBe("accept-edits");
    expect(statusBar("bypass")).toBe("bypass");
  });
});

describe("presentApproval", () => {
  it("plan write and bash need a card, default deny", () => {
    const write = presentApproval({ tool: "write", mode: "plan", body: "target.txt" });
    expect(write).not.toBeNull();
    expect(write!.defaultAction).toBe("deny");
    expect(write!.mode).toBe("plan");
    const bash = presentApproval({ tool: "bash", mode: "plan", body: "ls" });
    expect(bash).not.toBeNull();
    expect(bash!.defaultAction).toBe("deny");
  });

  it("accept-edits auto file has no card; bash still has one, default allow", () => {
    expect(presentApproval({ tool: "write", mode: "accept-edits" })).toBeNull();
    expect(presentApproval({ tool: "edit", mode: "accept-edits" })).toBeNull();
    const bash = presentApproval({ tool: "bash", mode: "accept-edits", body: "ls" });
    expect(bash).not.toBeNull();
    expect(bash!.defaultAction).toBe("allow");
  });

  it("bypass never renders a card", () => {
    expect(presentApproval({ tool: "bash", mode: "bypass" })).toBeNull();
    expect(presentApproval({ tool: "write", mode: "bypass" })).toBeNull();
  });
});

describe("resolveApproval", () => {
  const card = presentApproval({ tool: "bash", mode: "accept-edits", body: "ls" })!;

  it("y allows, n denies, a session-allows by tool name, escape interrupts", () => {
    expect(resolveApproval(card, "y")).toEqual({ decision: "allow" });
    expect(resolveApproval(card, "n")).toEqual({ decision: "deny" });
    expect(resolveApproval(card, "a")).toEqual({
      decision: "allow-session",
      sessionTool: "bash",
    });
    expect(resolveApproval(card, "escape")).toEqual({ decision: "interrupt" });
  });

  it("render shows tool, mode, and actions", () => {
    const text = renderApproval(card);
    expect(text).toMatch(/tool: bash/);
    expect(text).toMatch(/mode: accept-edits/);
    expect(text).toMatch(/允许/);
    expect(text).toMatch(/拒绝/);
  });
});

describe("interruptTurn", () => {
  it("marks the turn interrupted", () => {
    expect(interruptTurn()).toEqual({ interrupted: true });
  });
});

describe("handleLine", () => {
  it("parses /mode and leaves other text as a prompt", () => {
    expect(handleLine("/mode accept-edits", "plan")).toEqual({
      type: "mode",
      mode: "accept-edits",
    });
    expect(handleLine("list files", "plan")).toEqual({
      type: "prompt",
      text: "list files",
    });
    expect(handleLine("  ", "plan")).toEqual({ type: "empty" });
  });
});

describe("approveLive", () => {
  it("renders a card and maps y/n/a/escape", async () => {
    const writes: string[] = [];
    const io = {
      write(text: string) {
        writes.push(text);
      },
      async readKey() {
        return "y";
      },
    };
    await expect(
      approveLive({ tool: "bash", mode: "plan", body: "ls" }, io),
    ).resolves.toBe("allow");
    expect(writes.join("")).toMatch(/tool: bash/);
    expect(writes.join("")).toMatch(/mode: plan/);
  });

  it("skips the card when auto-run", async () => {
    const writes: string[] = [];
    const decision = await approveLive(
      { tool: "read", mode: "plan" },
      { write: (t) => writes.push(t), readKey: async () => "n" },
    );
    expect(decision).toBe("allow");
    expect(writes).toEqual([]);
  });
});

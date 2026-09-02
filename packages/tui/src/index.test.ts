import { describe, expect, it } from "vitest";
import { acceptPlan, applyModeCommand, cycleMode } from "./index";

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

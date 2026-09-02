import { describe, it, expect } from "vitest";
import {
  DEFAULT_PERMISSION_MODE,
  parsePermissionMode,
  isPermissionMode,
  canAutoRun,
  PERMISSION_MODES,
} from "./index";

describe("permissions", () => {
  it("default mode is plan", () => {
    expect(DEFAULT_PERMISSION_MODE).toBe("plan");
    expect(parsePermissionMode(undefined)).toBe("plan");
    expect(isPermissionMode("plan")).toBe(true);
  });

  it("parse invalid full-auto throws with legal values", () => {
    expect(() => parsePermissionMode("full-auto")).toThrow(/plan/);
    expect(() => parsePermissionMode("full-auto")).toThrow(/accept-edits/);
    expect(() => parsePermissionMode("full-auto")).toThrow(/bypass/);
    expect(PERMISSION_MODES).toEqual(["plan", "accept-edits", "bypass"]);
  });

  it("accept-edits auto write not bash", () => {
    expect(canAutoRun("write", "accept-edits")).toBe(true);
    expect(canAutoRun("edit", "accept-edits")).toBe(true);
    expect(canAutoRun("bash", "accept-edits")).toBe(false);
    expect(canAutoRun("read", "accept-edits")).toBe(true);
  });

  it("session allow bash works only in accept-edits and bypass", () => {
    const allowed = new Set(["bash"]);
    expect(canAutoRun("bash", "accept-edits", { sessionAllowed: allowed })).toBe(true);
    expect(canAutoRun("bash", "bypass", { sessionAllowed: allowed })).toBe(true);
    expect(canAutoRun("bash", "bypass")).toBe(true);
  });

  it("plan ignores session allow", () => {
    const allowed = new Set(["bash", "write"]);
    expect(canAutoRun("bash", "plan", { sessionAllowed: allowed })).toBe(false);
    expect(canAutoRun("write", "plan", { sessionAllowed: allowed })).toBe(false);
    expect(canAutoRun("read", "plan")).toBe(true);
    expect(canAutoRun("glob", "plan")).toBe(true);
    expect(canAutoRun("grep", "plan")).toBe(true);
  });
});

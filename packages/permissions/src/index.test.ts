import { describe, it, expect } from "vitest";
import {
  DEFAULT_PERMISSION_MODE,
  parsePermissionMode,
  isPermissionMode,
  canAutoRun,
  isHardDenied,
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

  it("plan ignores session allow and denies write and edit", () => {
    const allowed = new Set(["bash", "write", "edit"]);
    expect(canAutoRun("bash", "plan", { sessionAllowed: allowed })).toBe(false);
    expect(canAutoRun("write", "plan", { sessionAllowed: allowed })).toBe(false);
    expect(canAutoRun("edit", "plan", { sessionAllowed: allowed })).toBe(false);
    expect(canAutoRun("write", "plan")).toBe(false);
    expect(canAutoRun("edit", "plan")).toBe(false);
    expect(canAutoRun("read", "plan")).toBe(true);
    expect(canAutoRun("glob", "plan")).toBe(true);
    expect(canAutoRun("grep", "plan")).toBe(true);
  });

  it("bypass allows write and edit", () => {
    expect(canAutoRun("write", "bypass")).toBe(true);
    expect(canAutoRun("edit", "bypass")).toBe(true);
    expect(canAutoRun("read", "bypass")).toBe(true);
    expect(canAutoRun("bash", "bypass")).toBe(true);
    expect(canAutoRun("glob", "bypass")).toBe(true);
    expect(canAutoRun("grep", "bypass")).toBe(true);
  });

  describe("security knife: bypass hard deny", () => {
    it("isHardDenied identifies dangerous bash patterns", () => {
      expect(isHardDenied("bash", "rm -rf /")).toBe(true);
      expect(isHardDenied("bash", "RM -RF /")).toBe(true);
      expect(isHardDenied("bash", "rm -fr /")).toBe(true);
      expect(isHardDenied("bash", "rm -r -f /")).toBe(true);
      expect(isHardDenied("bash", "mkfs /dev/sda1")).toBe(true);
      expect(isHardDenied("bash", "mkfs.ext4 /dev/nvme0n1")).toBe(true);
      expect(isHardDenied("bash", "dd if=/dev/zero of=/dev/sda")).toBe(true);
      expect(isHardDenied("bash", ":(){ :|:& };:")).toBe(true);
      expect(isHardDenied("bash", "shutdown -h now")).toBe(true);
      expect(isHardDenied("bash", "reboot")).toBe(true);
      expect(isHardDenied("bash", "echo pwned > /etc/passwd")).toBe(true);
      expect(isHardDenied("bash", "echo evil >> /etc/shadow")).toBe(true);
      expect(isHardDenied("bash", "cat payload | tee /etc/hosts")).toBe(true);
      expect(isHardDenied("bash", "cp malware /etc/cron.d/job")).toBe(true);
      expect(isHardDenied("bash", "touch /etc/bad")).toBe(true);

      // Safe commands are not hard-denied
      expect(isHardDenied("bash", "echo hello")).toBe(false);
      expect(isHardDenied("bash", "ls -la")).toBe(false);
      expect(isHardDenied("bash", "rm -rf ./build")).toBe(false);
      expect(isHardDenied("bash", { command: "echo safe" })).toBe(false);
      expect(isHardDenied("bash", { command: "rm -rf /" })).toBe(true);
    });

    it("isHardDenied identifies dangerous file writes to /etc", () => {
      expect(isHardDenied("write", "/etc/passwd")).toBe(true);
      expect(isHardDenied("write", { path: "/etc/shadow" })).toBe(true);
      expect(isHardDenied("edit", { path: "/etc/hosts" })).toBe(true);
      expect(isHardDenied("write", "safe/file.txt")).toBe(false);
      expect(isHardDenied("edit", { path: "src/index.ts" })).toBe(false);
    });

    it("bypass still false for hard-denied bash patterns; normal echo still true in bypass", () => {
      // Dangerous commands in bypass mode must return FALSE
      expect(canAutoRun("bash", "bypass", { args: "rm -rf /" })).toBe(false);
      expect(canAutoRun("bash", "bypass", "rm -rf /")).toBe(false);
      expect(canAutoRun("bash", "bypass", { command: "mkfs /dev/sda" })).toBe(false);
      expect(canAutoRun("bash", "bypass", { args: "dd if=/dev/zero of=/dev/sda" })).toBe(false);
      expect(canAutoRun("bash", "bypass", { args: ":(){ :|:& };:" })).toBe(false);
      expect(canAutoRun("bash", "bypass", { args: "shutdown" })).toBe(false);
      expect(canAutoRun("bash", "bypass", { args: "reboot" })).toBe(false);
      expect(canAutoRun("bash", "bypass", { args: "echo hacked > /etc/passwd" })).toBe(false);

      // Normal commands in bypass mode must return TRUE
      expect(canAutoRun("bash", "bypass", { args: "echo hello" })).toBe(true);
      expect(canAutoRun("bash", "bypass", "echo hello")).toBe(true);
      expect(canAutoRun("bash", "bypass")).toBe(true);
      expect(canAutoRun("write", "bypass", { args: "local.txt" })).toBe(true);
    });
  });
});

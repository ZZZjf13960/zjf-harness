import { describe, it, expect } from "vitest";
import { runCli } from "./run";

describe("cli", () => {
  it("defaults to plan", () => {
    const r = runCli([]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("mode=plan print=false");
  });

  it("--mode accept-edits", () => {
    const r = runCli(["--mode", "accept-edits"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("mode=accept-edits print=false");
  });

  it("--mode bypass", () => {
    const r = runCli(["--mode", "bypass"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("mode=bypass print=false");
  });

  it("--mode full-auto exits 1", () => {
    const r = runCli(["--mode", "full-auto"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/plan/);
    expect(r.stderr).toMatch(/accept-edits/);
    expect(r.stderr).toMatch(/bypass/);
  });

  it("-p does not change mode", () => {
    const r = runCli(["-p"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("mode=plan print=true");
    const r2 = runCli(["-p", "--mode", "accept-edits"]);
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout.trim()).toBe("mode=accept-edits print=true");
  });

  it("--help lists modes and default plan", () => {
    const r = runCli(["--help"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/plan/);
    expect(r.stdout).toMatch(/accept-edits/);
    expect(r.stdout).toMatch(/bypass/);
    expect(r.stdout).toMatch(/default: plan/);
  });
});

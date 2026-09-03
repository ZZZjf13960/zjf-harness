import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPreview } from "@zjf-harness/cli";

const printFlag = "-p";

function writeThenText(file: string) {
  let n = 0;
  return {
    complete: async () => {
      n += 1;
      if (n === 1) {
        return {
          text: "",
          toolCalls: [
            { id: "1", name: "write", arguments: { path: file, content: "nope" } },
          ],
        };
      }
      return { text: "ok", toolCalls: [] };
    },
  };
}

describe("approval card pops from the live loop", () => {
  it("TTY onApprove renders a card and deny does not land the write", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zjf-live-"));
    const file = path.join(dir, "target.txt");
    await writeFile(file, "before");
    const shown: string[] = [];
    const r = await runPreview(["change the file"], writeThenText(file), {
      interactive: true,
      write: (text: string) => {
        shown.push(text);
      },
      readKey: async () => "n",
      readLine: async () => "",
    });
    const out = shown.join("");
    expect(out).toMatch(/tool: write/);
    expect(out).toMatch(/mode: plan/);
    expect(r.exitCode).toBe(0);
    expect(await readFile(file, "utf8")).toBe("before");
  });

  it("print mode does not pop a card and stays fail-closed", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "zjf-live-"));
    const file = path.join(dir, "target.txt");
    await writeFile(file, "before");
    const shown: string[] = [];
    let keys = 0;
    const r = await runPreview([printFlag, "change the file"], writeThenText(file), {
      interactive: true,
      write: (text: string) => {
        shown.push(text);
      },
      readKey: async () => {
        keys += 1;
        return "y";
      },
    });
    expect(r.exitCode).not.toBe(0);
    expect(keys).toBe(0);
    expect(shown.join("")).not.toMatch(/tool: write/);
    expect(await readFile(file, "utf8")).toBe("before");
  });
});

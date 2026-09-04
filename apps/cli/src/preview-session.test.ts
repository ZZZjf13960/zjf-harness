import { describe, expect, it } from "vitest";
import { runPreview } from "./run";
import type { ModelClient, ModelTurn } from "@zjf-harness/core";

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
});

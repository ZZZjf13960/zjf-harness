import path from "node:path";
import { pathToFileURL } from "node:url";
import { runCli, runPreview, shouldRunPreview } from "./run";

export { runCli, runPreview, shouldRunPreview } from "./run";
export type { CliResult } from "./run";

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const result = shouldRunPreview(argv) ? await runPreview(argv) : runCli(argv);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

if (isDirectRun()) {
  void main();
}

# @zjf-harness/rpc

Owner: Antigravity

Thin JSON-RPC 2.0 server over stdin/stdout (JSONL, LF-only). Intended for eval harnesses and SDK drivers.

## Protocol

- One JSON-RPC request object per stdin line; one JSON-RPC response object per stdout line.
- Never write non-JSON protocol traffic to stdout (logs go to stderr).
- Empty lines are skipped.
- Permission modes match CLI/TUI: `plan` | `accept-edits` | `bypass`.

## Methods

| Method | Params | Result |
|---|---|---|
| `ping` | — | `{ ok: true }` |
| `session.get` | — | `{ mode, workspaceRoot, messageCount }` |
| `session.setMode` | `{ mode }` | `{ mode }` (illegal mode → `-32602`) |
| `prompt` | `{ message }` | `{ exitCode, stdout, stderr, gatedTool? }` (approval fail-closed like `-p`) |
| `shutdown` | — | `{ ok: true }` then end the serve loop |

Unknown method → `-32601`. Parse errors → `-32700` when an `id` can be recovered, otherwise skip and log to stderr.

## CLI

```bash
zjf-harness --rpc --mode bypass
```

Optional `--workspace <path>`. Interactive RPC approval is deferred; MCP is deferred.

# zjf-harness

Own coding agent harness: drive LLMs through coding tasks; tools, context, sessions, permissions, and TUI.

## Packages

- `apps/cli` — thin CLI (`--mode`, `-p` / `--print`)
- `packages/permissions` — permission modes and auto-run gates
- `packages/tools` — tool registry
- `packages/rpc` — JSON-RPC server stub
- `packages/mcp` — MCP client stub
- `packages/tui` — TUI (runtime not changed in this scaffold)

`--mode` wire names: `plan` | `accept-edits` | `bypass` (default `plan`). See [docs/specs/interaction-v0.md](docs/specs/interaction-v0.md).

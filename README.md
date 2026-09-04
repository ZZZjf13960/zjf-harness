# zjf-harness

Own coding agent harness: drive LLMs through coding tasks.

## Sit down and run

```bash
git clone https://github.com/ZZZjf13960/zjf-harness
pnpm install
export OPENAI_API_KEY
pnpm --filter @zjf-harness/cli start
```

Running the CLI without a prompt opens the full-screen terminal UI. Type a
request and press Enter. An empty line or Esc exits.

- Default mode is `plan` (read-only).
- Shift+Tab cycles `plan` → `accept-edits` → `bypass`.
- `/mode plan`, `/mode accept-edits`, and `/mode bypass` jump directly.
- Approval cards take `y`, `n`, `a`, or Esc without requiring Enter.
- Esc interrupts a model request or exits from the input prompt.

Pass a prompt to start immediately:

```bash
pnpm --filter @zjf-harness/cli start -- "summarize this repository"
```

Repo: https://github.com/ZZZjf13960/zjf-harness
Spec: docs/specs/interaction-v0.md
Print mode (-p) is fail-closed.

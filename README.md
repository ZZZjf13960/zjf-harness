# zjf-harness

Own coding agent harness: drive LLMs through coding tasks.

git clone https://github.com/ZZZjf13960/zjf-harness
cd zjf-harness
pnpm install
export OPENAI_API_KEY=...
pnpm --filter @zjf-harness/cli start -- "list files in this directory"

Empty line ends a TTY session.
Default mode is plan (read-only).
TTY shows a status bar. Gated tools take y, n, a, or Esc. Slash mode switches. Follow-up lines continue.
Print mode is fail-closed.
Spec: docs/specs/interaction-v0.md

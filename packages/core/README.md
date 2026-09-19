# packages/core

Owner：技术负责人

Session + agent loop for the preview CLI. Permission gating uses `@zjf-harness/permissions`. Tool execution uses `@zjf-harness/tools`. Approval cards stay in `@zjf-harness/tui`.

## model.complete (createOpenAIClient)

`createOpenAIClient` applies a hard timeout and limited retries at the model client layer (TUI, `-p`, and `--rpc` all inherit it):

- **timeoutMs** (default `60000`): aborts the in-flight fetch/stream so a hung provider cannot hang forever. Mid-stream timeout fails the call (no silent partial success).
- **maxRetries** (default `2`): retries only HTTP **429** and **5xx** (exponential backoff from **retryBaseDelayMs** default `250`). Does not retry other 4xx, auth errors, timeouts, or successful responses. Caller `AbortSignal` abort skips further retries.

Pass options as the second argument: `createOpenAIClient(env, { timeoutMs, maxRetries, retryBaseDelayMs })`.

# packages/tui

Owner：TUI 体验交互

P1 在 pi 的 TUI 上定制交互层。权限 mode 的 wire 名与 CLI `--mode` 共用，见 `docs/specs/interaction-v0.md`。

本包先导出交互入口，不实现全屏 TUI：

- `acceptPlan`：接受当前计划，会话切到 `accept-edits`
- `applyModeCommand`：解析 `/mode plan|accept-edits|bypass`
- `cycleMode`：Shift+Tab 循环三种 mode

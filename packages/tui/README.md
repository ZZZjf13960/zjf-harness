# packages/tui

Owner：TUI 体验交互

P1 交互入口（全屏 TUI 不进这期）：

- `acceptPlan`：接受当前计划，会话切到 `accept-edits`
- `applyModeCommand`：解析 `/mode plan|accept-edits|bypass`
- `cycleMode`：Shift+Tab 循环三种 mode
- `statusBar`：底栏原文显示当前 mode
- `presentApproval` / `resolveApproval`：审批卡。`bypass` 不弹卡；`y` 允许 / `n` 拒绝 / `a` 本会话允许该工具 / Esc 中断
- `interruptTurn`：Esc 中断当前 turn

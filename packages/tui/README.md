# packages/tui

Owner：TUI 体验交互

第一版接到 live loop：

- 状态栏：liveBanner / statusBar 原文显示 plan | accept-edits | bypass
- /mode：handleLine / applyModeCommand
- 审批卡：presentApproval / resolveApproval / approveLive（y 允许 / n 拒绝 / a 本会话允许该工具 / Esc 中断）
- bypass 不弹卡；-p 不走卡，fail-closed

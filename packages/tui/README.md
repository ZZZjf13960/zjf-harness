# packages/tui

Owner：TUI 体验交互

原生终端 TUI 已接入 live loop：

- 无参数启动进入全屏消息区、输入区和常驻状态栏
- 状态栏原文显示 plan | accept-edits | bypass
- Shift+Tab 循环切换 mode，/mode 精确切换
- 原生按键处理，无需按回车确认审批
- Esc 退出输入、打断模型请求或中断审批
- /mode：handleLine / applyModeCommand
- 审批卡：presentApproval / resolveApproval / approveLive（y 允许 / n 拒绝 / a 本会话允许该工具 / Esc 中断）
- bypass 不弹卡；-p 不走卡，fail-closed

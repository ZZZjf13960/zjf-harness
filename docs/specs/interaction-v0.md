# 交互规范 v0

> 状态：提纲，供 P1 对齐
> 日期：2026-09-02
> Owner：TUI 体验交互（`packages/tui`）
> 对齐对象：`packages/permissions` 实现枚举、`apps/cli --mode`、周五 demo 验收

本文锁定人能看见什么、能点什么。权限判定的最终实现以 permissions 包为准，但 wire 名不得另起。

---

## 1. 目标与非目标

**P1 目标**

- 可交互 TUI（基于 pi TUI 定制）与非交互 `-p` 共用同一套 mode。
- 用户在任何时刻都知道自己处于哪种 mode，以及下一步会不会改仓库。
- 审批是一种交互，不是日志：一次工具调用对应一张卡片，决策可逆（拒绝 / 中断）。

**非目标（本期不做）**

- IDE 插件、Web UI、第四种 mode。
- 自造 suggest / auto-edit / full-auto / acceptEdits 等别名（可在文档里对照，禁止出现在 CLI、RPC、TUI 状态栏）。

---

## 2. 锁定的 wire 名

TypeScript 合同（实现必须逐字使用）：

    export type PermissionMode = "plan" | "accept-edits" | "bypass";
    export const DEFAULT_PERMISSION_MODE: PermissionMode = "plan";

| 字段 | 值 |
|---|---|
| CLI | `--mode plan` / `--mode accept-edits` / `--mode bypass` |
| 默认 | `plan` |
| TUI 状态栏 | 原文显示上述三个字符串 |
| RPC / SDK | 同一组字符串，禁止 camelCase 变体 |

`--mode` 与 TUI 切 mode 是同一状态机的两个入口，不是两套策略。

---

## 3. 状态机

三种 mode 是全局会话状态，作用于「下一笔工具调用」。切 mode 不回放已经执行完的调用。任意时刻 Esc 中断当前 turn；用户可在三种 mode 间直接跳转（不必按序）。启动默认落在 `plan`。接受计划后进入 `accept-edits`。

### 3.1 `plan`（默认）

**Agent 可自动做：** 读文件、搜索、列目录、在界面里写一份计划（markdown）。
**必须停下等人：** write / edit / bash / 有副作用的 MCP。
**用户看见：** 状态栏 `plan`；对话流；右侧或下方计划面板（未接受前是草稿）。

| 操作 | 行为 |
|---|---|
| 执行计划 | 接受当前计划，会话切到 `accept-edits`，按计划继续 |
| 仅保留计划 | 计划留在面板，mode 仍为 `plan`，不改仓库 |
| 拒绝这次工具 | 该 tool call 失败返回给模型，mode 不变 |
| 切 mode | 立即生效于下一笔 tool call |
| Esc | 停当前 turn；草稿计划留在屏幕 |

**非交互 `-p`：** fail-closed。只要模型发出需要审批的调用，进程以非 0 退出，不静默改文件。CI 里要用 `-p` 必须显式 `--mode bypass`。

### 3.2 `accept-edits`

**Agent 可自动做：** 文件 write / edit（自动落地，屏幕上打 diff）。读和搜索同 `plan`。
**必须停下等人：** bash、网络、会执行代码或改环境的 MCP。
**用户看见：** 状态栏 `accept-edits`；每笔文件改动的 diff；bash/MCP 的审批卡。

| 操作 | 行为 |
|---|---|
| 允许这次 | 仅放行当前这一笔 |
| 拒绝 | 该调用失败返回给模型 |
| 本会话允许该工具 | 同一 tool 名在本会话内不再问（仍受 mode 约束：回到 `plan` 后失效） |
| 切到 `plan` / `bypass` | 立即生效于下一笔 |
| Esc | 停当前 turn；已落地的 edit 不自动回滚（回滚走 git，v0 不做 checkpoint UI） |

**非交互 `-p`：** 文件 edit 可自动执行；遇到需要审批的 bash/MCP 则 fail-closed。

### 3.3 `bypass`

**Agent 可自动做：** 全部已注册工具。
**必须停下等人：** 无（权限层另有硬禁名单的除外；那是 permissions 的事，TUI 只展示已跳过）。
**用户看见：** 状态栏 `bypass`（必须比另外两种更醒目）；工具流与 diff 仍完整播放，只是不弹卡。
**用户能做：** Esc 中断；切回更严的 mode。没有确认按钮。

**非交互 `-p`：** 自动执行，适合 CI。仍应把工具轨迹打到 stderr/日志，方便评测回放。

---

## 4. 审批卡

一张卡，一种决策，禁止按工具类型做三套 UI。

- 卡头：tool 名 + 当前 mode。
- bash：主区域是命令和 cwd。
- write/edit：主区域是 diff，不是命令行。
- `plan` 下若模型仍发出 write/bash，卡上要写清「当前是 plan，允许将立刻改仓库」。
- 焦点默认在拒绝（`plan`）或允许（`accept-edits`）。`bypass` 不渲染这张卡。
- 键盘：y 允许 / n 拒绝 / a 本会话允许该工具 / Esc 中断 turn。
- 按钮：[允许] [拒绝] [本会话允许该工具]

---

## 5. 状态栏

TUI 底栏常驻当前 mode，原文显示 `plan` / `accept-edits` / `bypass`，不得翻译、不得缩写。

- `plan`：提醒不会改仓库，除非你批准
- `accept-edits`：提醒文件会直接改，命令仍会问
- `bypass`：警告全自动

切 mode 的入口：

- Shift+Tab 循环三种 mode
- `/mode plan` / `/mode accept-edits` / `/mode bypass` 精确跳转
- CLI 启动统一 `--mode`，不要发明新 flag

切 mode 后状态栏立刻更新；正在等待审批的卡作废，按新 mode 重算是否还要问。

---

## 6. 中断、错误、转向

| 事件 | 界面 |
|---|---|
| Esc / Ctrl+C 一次 | 停当前 turn，已流式的文字与草稿计划保留 |
| 工具失败 | 内联错误，不弹模态；模型可继续 |
| 用户插入一句话 | steering：当前 turn 停，新消息进下一轮 |
| 启动时未知 `--mode` | 打印合法值，退出非 0，不要默默回落到 `plan` |

v0 不做 checkpoint / 一键回滚 UI。需要撤销时告诉用户用 git。

---

## 7. 与 CLI `-p` 的关系

| mode | `-p` 行为 |
|---|---|
| `plan` | 只读任务可跑完；一有副作用调用则非 0 退出 |
| `accept-edits` | 文件改动自动落地；bash/MCP 需审批则非 0 退出 |
| `bypass` | 全自动；这是非交互编码任务的预期入口 |

禁止把 `-p` 自动升成 `bypass`。要自动，调用方自己传 `--mode bypass`。

---

## 8. 周五 demo 验收清单

1. 不传 `--mode` 启动，状态栏为 `plan`。
2. `--mode accept-edits` / `--mode bypass` / `--mode plan` 启动后状态栏与 flag 一致。
3. `--mode full-auto`（非法值）启动失败，非 0。
4. `plan` 下模型若请求 write 或 bash，弹出审批卡，未允许前工作区文件不变。
5. 在 `plan` 下接受计划后，状态栏变为 `accept-edits`。
6. `accept-edits` 下文件 edit 自动落地且屏幕有 diff；bash 仍弹卡。
7. `bypass` 下 bash 不弹卡，状态栏为 `bypass`；Esc 仍能打断。
8. `-p --mode plan` 遇到 write 时进程非 0 且不改文件；`-p --mode bypass` 可以改文件。
9. Shift+Tab（或 `/mode`）切换后，状态栏立刻变，且下一笔工具按新 mode 问或不问。

---

## 9. 留给 permissions / 工具侧的开放问题

TUI 已假定下面两条，请实现侧用枚举确认或打回：

1. `accept-edits`：自动 apply 文件 edit，bash/网络/副作用 MCP 仍 gate。若实现不是这样，先改规格再写代码。
2. 「本会话允许该工具」的粒度是 tool 名（bash、edit），不是 tool+argv。路径级白名单不进 v0。

---

## 10. 对照（只读，不进 wire）

| 我们 | Claude Code 概念 | Codex CLI 概念 |
|---|---|---|
| `plan` | plan mode | suggest（只读/需确认） |
| `accept-edits` | accept edits | auto-edit |
| `bypass` | bypass permissions | full-auto |

对照表只出现在本文档。代码、flag、状态栏只用左列。

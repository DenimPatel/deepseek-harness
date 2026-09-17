---
description: "Web 单步模式：替换输入框的暂停卡片、输入框上的单步按钮，以及可观测面板中的暂停控件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-step-mode

[English](README.md) | 中文

## 概述

单步执行模式的浏览器半边。它提供武装单步运行的第一个用户手势，并把主机拦下的暂停呈现出来，共有三处，它们共享同一个待处理值：

- 输入框接管卡片：暂停拦住 Agent 时替换常驻输入框；
- 输入框工具行的单步按钮：武装下一次运行后再发送草稿；
- 可观测面板的控制条：在 Flow 账本可见时推进运行。

## 目录

- [手势](#gestures)
- [注册位置](#registration-surfaces)
- [与主机侧的连接](#wiring-with-the-host)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="gestures"></a>
## 手势

- **输入框中的 `Alt+Enter`** 武装被寻址 Session 的下一次运行，然后发送草稿。该手势由 `ui-conversation` 拥有，并通过 `ctx.get` 委托给本包的 `ctx.stepMode` 服务，因此两个包都不导入对方的运行时值。
- **`Shift+Enter`** 在暂停接管输入框时推进一步。在输入草稿时它仍是换行，因为接管卡片替换了输入框，其中没有编辑器。
- **单步 / 继续运行 / 停止运行** 同时出现在接管卡片与面板控制条上。停止运行通过 Session 自身的取消来中止本次运行。

武装失败时按失败处理：主机没有 `/step` 命令时，输入框显示失败并且不发送任何内容，而不是改为普通运行。暂停按放行处理，由主机侧包负责。

<a id="registration-surfaces"></a>
## 注册位置

| 位置 | 条目 | 渲染内容 |
|---|---|---|
| `conversation.composer` | 以 `PendingStepPause` 为条件的链式选择器 | 暂停接管卡片 |
| `conversation.input.right` | `step-run` | 单步按钮 |
| `sidebar.right.pane.tab.controls` | single | 可观测面板控制条 |

面板位置由 `ui-observability` 声明，由本包填充。三处读取同一个已发布的待处理交互，因此无论用户从哪里操作，同一次暂停的应答方式都一致。

<a id="wiring-with-the-host"></a>
## 与主机侧的连接

插件订阅被转发的 `step-mode/advance` waterfall，把每个请求发布为 Session 待处理交互，并返回所选决策；委派时调用 `next()` 交给剩余应答者。`ctx.stepMode.armNextRun(sessionId)` 通过 Session 已有的命令动词执行主机 `/step` 命令，并报告主机是否接受。

<a id="model-experience"></a>
## 模型体验

None, as the browser half sends one `/step` command per armed run and resolves a Host waterfall without adding prompt content or tokens.

#### KV Cache effect

None. The browser half never reaches a model request.

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **重新加载会丢失暂停。** 待处理值只存在于收到它的那个浏览器世代中，主机不会向新的世代重新宣告暂停。
- **被拒绝的武装会保留草稿。** 输入框显示拒绝信息而不会发送普通运行；草稿保留在状态机中以便之后再次发送。
- **单步模式不会被持久化。** 武装只属于一次运行，从不写入设置，因此之后的运行不会继承它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

`'step'` 输入框手势与 `stepRun` 输入框栏能力位于 `ui-conversation`；本包提供该能力、暂停的各处呈现，以及 `ctx.stepMode` 服务。

</details>

**运行时不变式：** 不发布伴随包。插件唯一拥有的关系是每个 Session 一个待处理交互，该关系已由 `uiSession.registerPendingInteraction` 管理并释放。

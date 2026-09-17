---
description: "单步执行模式：已武装的运行在每个模型请求与每个工具调用前停下，等待面向人的应答者决定如何前进。"
kind: "package-reference"
---

# @deepseek-ai/dsh-step-mode

[English](README.md) | 中文

## 概述

单步执行模式的主机侧。被武装的 Agent 在每个已配置的暂停点停下，等待 `step-mode/advance` waterfall 上的应答者；随产品发布的应答者是 Web 端单步模式面板。暂停点就是已有文档的 `agent/pre-step` 与 `tools/pre-execute` waterfall，因此 agent loop 与工具注册表都不需要改动。

## 目录

- [配置](#config)
- [命令](#commands)
- [暂停点](#pause-points)
- [失败行为](#failure-behavior)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="config"></a>
## 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `breakpoints` | `['context', 'tool']` | 需要停下的暂停点。空列表在不卸载插件的前提下关闭单步；`/step` 仍可武装并报告状态。 |

<a id="commands"></a>
## 命令

`/step` 武装被寻址 Agent 的下一次运行；`/step off` 释放尚未开始运行的武装。

武装按每次运行一次性生效。出现以下情况时武装被释放：应答者选择继续运行的决策、被武装的运行进入 `idle`，或使用 `/step off`。

<a id="pause-points"></a>
## 暂停点

- `context` — 该步已领取输入并完成请求组装之后、`step/start` 之前。首个被提议且不带消息的步骤会在不发起模型调用的情况下结束该轮，因此不会被拦下；后续的空步骤仍会基于日志中的工具结果发起请求，因此会被拦下。
- `tool` — 位于 `tools/pre-execute`，在派发之前、该调用的审批询问之前，因此被拦下的调用会先于任何权限请求做出决定。`run_code` 子调用走同一阶段，同样会被拦下。

每次暂停都会分发 `step-mode/advance`，携带暂停点、轮次与步骤；`tool` 暂停点还会携带被拦下调用的名称与 id。应答者返回 `{ action: 'step' }` 表示只运行这一个单元并在下一个暂停点再次停下，返回 `{ action: 'resume' }` 表示不再暂停地运行完本次运行。

<a id="failure-behavior"></a>
## 失败行为

暂停一律放行。没有应答者时分发默认继续；分发被拒绝（浏览器已断开）、监听器抛错以及轮次被取消，都会继续，因此无人值守的运行永远不会挂起。轮次自身的取消仍然决定结果：监听器返回步骤决策，由循环的 `throwIfAborted` 执行取消。人类交互只对运行时根 Agent 有效，因此被其他 Agent 拥有的 Agent 永远不会被拦下。

Agent Note：

- [.agents/notes/implemented/feature/2026-09-16-step-execution-mode.zh.md](../../../.agents/notes/implemented/feature/2026-09-16-step-execution-mode.zh.md)

<a id="model-experience"></a>
## 模型体验

None, as a pause holds a request at a documented boundary without adding prompt content, a tool schema, or tokens.

#### KV Cache effect

None. Holding a step changes when a request is sent, never what it contains.

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **暂停期间的取消不会恢复已领取的输入。** `agent/pre-step` 在 `inbox.claim()` 之后运行，因此暂停发生在该步骤的消息离开持久收件箱之后；此时取消会在不重新发出这些消息的情况下结束该轮，与任何在领取之后被取消的轮次一致。
- **重新加载不会重新宣告暂停。** 待处理值属于收到它的那个 socket 世代的浏览器半边；重新加载后的页面看不到暂停，只有在断开释放它之后运行才会继续。
- **只有随产品发布的 Web 应答者能以交互方式释放暂停。** 无头与 ACP 运行会武装但不会停下，因为没有应答者回应 waterfall。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

该插件是函数插件，没有服务面：其状态的唯一消费者是它自己的 `/step` 命令与两个监听器。`packages/client/ui-step-mode` 提供可交互的应答者。

</details>

**运行时不变式：** 不发布伴随包。暂停是一次 waterfall 上的请求/响应，不发布任何独立观测；拦下一步不会留下超出循环已记录的步骤边界之外的持久痕迹。

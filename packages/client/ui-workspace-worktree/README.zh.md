---
description: "Web 并行编辑界面：项目行的 New worktree 入口、每个 worktree 行的状态与操作，以及 Session header 的合并/丢弃控件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace-worktree

[English](README.md) | 中文

## 概述

本包渲染 Web GUI 的并行编辑界面：在每个项目的 New session 按钮旁的 New session in worktree 入口、每个 worktree 检出嵌套显示的一行（含其分支与推进程度）、提供 Merge 与 Discard 的 Session header 控件，以及创建对话框。它通过框架的 Workspace 钩子读取 Workspace 行，并且只通过注入的 `ctx.gitWorktrees` facade 触达 Host，因此浏览器中不运行任何 git 命令。请把它加载在提供 `gitWorktree` Remote namespace 的 Host 上；没有该服务时该插件保持 pending，不贡献任何内容。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

New session in worktree 入口位于项目的 New session 按钮旁。首次激活会观察项目目录：目录不是仓库、自身就是链接 worktree，或 Host 上没有 git 时，会就地报告原因而不打开对话框，随后该入口保持禁用。对话框接收 worktree 名称，显示它将作为分支名使用的名称，说明 Host 将切出的基线版本，并且只在部署配置了 setup 命令时把它作为复选框提供。创建检出后会通过工作区导航服务打开其 Session，因此新 Session 会落在侧栏中它的项目下。

每个 worktree 行显示其分支与一个状态 chip：缺失、一个已改动文件、多个已改动文件、领先若干提交、落后若干提交或干净。指针悬停在该 chip 上会刷新它，行菜单提供 Merge、Discard，以及仅用于丢弃目录已消失的注册的 Forget。Discard 会先弹出确认，列出涉及的文件与提交，然后移除检出与注册，同时保持 Session transcript 可读。Session header 控件在用户正在阅读的位置重复 Merge 与 Discard，并在 Session 运行中或检出缺失时禁用二者并给出原因。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

本包向三个 slot 贡献内容：`sidebar.workspaces.projectActions` 提供创建入口，`sidebar.workspaces.worktreeRow` 提供一个 worktree 行的状态与操作，`conversation.session.header.actions` 提供 Session 控件。每个组件都接收四个 props share，并且只通过 `gitWorktrees` 注入触达 Host；任何组件自身都不订阅外部数据，也看不到 `ctx`。嵌套不是本包的职责：`packages/client/ui-workspace` 从 Workspace descriptor 推导 worktree 分组，并把本包的行渲染进每个分组。

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只为人渲染和操作宿主上的 worktree 状态，不触及提示词、消息、schema、流或工具结果。

#### KV Cache 影响

无；本包从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **状态是采样而非订阅**——被其他进程改动的检出在下次刷新前一直显示旧的计数，刷新仅在指针指向行 chip 或 header 时发生，且没有轮询。
- **对话框预览的是名称而不是最终分支**——显示的分支行只是回显输入的名称，而 Host 会应用其配置的前缀与 slug；行上显示的是实际创建的分支。
- **没有在文件管理器中显示**——本插件不得运行时 import 其他功能插件的值，而宿主 open-in-app seam 不导出 Cordis 服务，因此该行改为显示检出路径。
- **没有批量操作**——Merge 与 Discard 每次只作用于一个 worktree Workspace，通过其行或 Session header 触发。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包渲染的每个事实都来自 Workspace 流与 `gitWorktrees` facade，因此它不拥有可独立观测的关系可供检查。

---
description: "Host worktree 控制：创建、查看、合并与丢弃每个会话独立的 git worktree 检出及其 Workspace 注册。"
kind: "package-reference"
---
# Git Worktree Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-git-worktree-controller` 拥有 Host 的 `ctx.gitWorktreeController` 服务和生成的 Client `ctx.remote.gitWorktree` namespace。它的 Remote 方法负责观察目录、创建链接 worktree 并注册拥有它的 Workspace、报告某个检出的状态、把它的分支合并进父仓库，以及连同其注册一起丢弃该检出。当 Client 必须为用户的每个 Session 提供一个隔离检出时，请通过 API 网关使用它。本包自身不含任何 git 逻辑：每个操作都委托给 `ctx.gitWorktree`。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Host 控制器会把服务抛出的每个 `GitWorktreeError` 转换为携带稳定 `git-worktree/*` 错误码的 `RemoteError`，因此 Client 渲染的是具体原因而不是笼统失败。`create` 先执行 git 操作，再注册 Workspace，而该注册在一次 create 写入中写入 descriptor，因此失败绝不会留下已注册却缺失来源的检出。返回值只包含新 Workspace 的 id、其路径与分支，因为 Workspace 行本身通过 Workspace 状态流到达；Client 会等这条权威行到达后再解析 `create`，而不是渲染一行它自己编造的数据。

Client 入口提供 `GitWorktreeCommandError`（携带 `RemoteFailure`），以及 worktree 界面注入的 `ctx.gitWorktrees` facade：`probe`、`create`、`status`、`merge` 与 `discard`。`merge` 会区分已完成的合并与冲突，因此调用方可以列出冲突路径，并表明父工作树未被改动。

-----

<a id="model-experience"></a>
## 模型体验

无，因为 worktree Remote namespace 只改动宿主上的检出，并不注册提示词、工具、schema 或会话事件。

#### KV Cache 影响

无直接影响；worktree 操作改变的是磁盘上的文件，从不改变模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **create 不能盲目重试**——git 步骤先创建目录和分支，再注册 Workspace，因此在失败原因不明后重试会以 `path-exists` 或 `branch-exists` 失败，而不是补完原请求；调用方通过丢弃或接管 `probe` 报告的检出来恢复。
- **无法取消**——Remote 调用会运行到结束，因此耗时的 `git worktree add` 或大体积的配置复制无法从浏览器中止。
- **检出状态按需读取**——`status` 与 `merge` 查询检出当前的 git 状态而不是缓存的投影，因此调用方需要刷新自己展示的计数，并且在下次调用时才会得知 harness 之外发生的改动。
- **合并是本地操作**——该 namespace 只合并进记录的父仓库，从不访问远端，因此没有 pull request 与远端分支清理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包把 `ctx.gitWorktree` 的结果转发给 Remote 调用方，自身不拥有持久状态；descriptor 记录由 Workspace 注册表拥有。

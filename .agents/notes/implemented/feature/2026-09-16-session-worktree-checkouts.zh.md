# Agent Note: 每个会话独立 worktree 检出以实现并行编辑

Status: implemented

[English](2026-09-16-session-worktree-checkouts.md) | 中文

## 问题

Web GUI 已经可以让多个 Session agent 同时对同一个 Workspace 运行，但该 Workspace 中的所有 Session 共享同一个工作树。Session 的目录在创建时被固化进 header，而正是这个目录决定了工具 root、文件系统 sandbox 的 workspace root、Session 持久化以及跨进程写租约。因此，两个 Session 编辑同一个仓库时会互相覆盖对方的改动。任何锁都无法解决这个问题：写租约串行化的是对 Session 日志的写入，而不是对文件系统的写入。隔离必须早于 Session 存在，因为 Session 的目录之后无法更改；所以该功能必须先创建检出，再把 Session 开进其中。

## 决策

Session 可以创建在它自己的 `git worktree` 中。`@deepseek-ai/dsh-workspace-worktree`（`packages/workspace/workspace-worktree`）负责 `ctx.gitWorktree`，并通过 `ctx.subprocess` 以 argv 数组执行 `git`，绝不使用 shell 字符串，因此分支名或路径无法注入命令。

创建 worktree 是一个操作、两个效果：先执行 `git worktree add -b <branch> <path> HEAD`，再写入一条携带 `WorkspaceWorktree` descriptor 的 Workspace 记录。descriptor 包含 `parentWorkspaceId`、`repoPath`、`branch`、`baseBranch` 与 `baseRevision`，其归属是 Workspace 域，因为该检出就是路径为新目录的普通 Workspace。于是 Session 成员关系、Session 持久化与侧栏 feed 都通过既有路径保持不变。`workspace` 域版本仍为 2：该字段可选，且在该字段出现之前写入的记录中缺失，因此升级不会改变这些记录的读取结果。`WorkspaceRegistry.createWorktree` 在一次 create 写入中写入 descriptor，而不是先创建普通记录再打补丁，因此失败绝不会留下已注册却缺失来源的检出。它同样拒绝接管一个已注册为普通 Workspace 的目录，否则 descriptor 会被静默丢弃，该检出会渲染成没有任何 merge 或 discard 的普通项目。

`@deepseek-ai/dsh-api-git-worktree-controller`（`packages/api/git-worktree-controller`）暴露 `gitWorktree` Remote namespace，包含 `probe`、`create`、`status`、`merge` 与 `discard`。创建检出只返回 id 和路径，随后 Client 通过既有的 session 创建路径在返回的 Workspace 上打开 Session，因此创建 Session 的方式仍然只有一种。

默认值都是推导出来的，而每个随部署变化的选项都是经过校验的 `Config` 字段：`worktreeRoot`（默认是仓库旁的 `<repo>.worktrees`）、`branchPrefix`（未设置时创建的分支不带前缀）、`gitExecutable`、`setupCommand` 与 `copyGlobs`。新建检出没有依赖目录，也没有被忽略的文件，因此除非部署显式配置，否则不会复制或安装任何内容；配置的复制先于 setup 命令执行，而 setup 失败会保留检出并上报，使 Session 仍能启动并由人工修复。

`@deepseek-ai/dsh-client-ui-workspace-worktree`（`packages/client/ui-workspace-worktree`）负责界面。它把 worktree 行嵌套在所属项目下，在项目行的 New session 按钮旁加入 New session in worktree 入口，并在 Session header 中渲染分支 chip、已改动文件计数、Merge 与 Discard。分组由 `deriveGroups`（`packages/client/ui-workspace/src/client/tree.ts`）从 descriptor 推导；当 worktree 的父 Workspace 不存在时，它会渲染在顶层而不是消失。

## 落地变更的显式前置条件

`merge` 只在父仓库的工作树干净、且没有进行中的 merge、revert、cherry-pick 或 rebase 时才在父仓库中运行。发生冲突的 merge 会报告冲突路径然后 abort，因此父工作树绝不会停留在半合并状态。`discard` 会移除检出和 Workspace 注册，但绝不删除 Session 历史：Session 日志以检出路径为键存放在 harness home 目录下，删除检出后它们仍可读取。

## 考虑过的替代方案

**继续共用同一个工作树并串行化写入方。** 否决，因为既有的写租约保护的是 Session 日志而不是文件系统。串行化工具仍会丢失读取与写入之间发生的编辑，而且会禁止该功能本就允许的并行工作。

**改为在 worktree 中隔离 subagent 或 Team member。** 本次变更否决，因为 Team 的共享检出是 Team 域的刻意决策，而在那里创建 worktree、命名分支、合并策略、被忽略文件、构建产物与清理都属于部署选择。本决策由用户按 Session 发起，不触及 subagent 与 Team 域；Team member 的 worktree 隔离仍待讨论，且不由本注记隐含。

**把 descriptor 放进 Session header 或第二个存储域。** Session header 是创建时即固化的持久 Session 格式字段集合，而该 descriptor 是 Workspace 的属性而非 Session 的属性。第二个域会把同一个事实拆给两个 owner，并迫使侧栏 join 两条 stream 才知道某个检出属于哪个项目。

**worktree 的 Session 一旦 idle 就自动 merge。** 否决，因为它会在没有明确动作的情况下写入用户的检出；在用户正在阅读 diff 时落地的 merge 比多一次点击更糟。

**把检出放在仓库内部或 harness home 目录下。** 放在仓库内部会让父 Workspace 的文件 watcher、搜索工具与 `git status` 遍历第二份完整检出，并且需要修改用户的忽略规则。放在 home 目录下会让检出在用户自己的工具与文件管理器中不可见。兄弟目录位于工作树之外，无需忽略条目，也可以直接访问。

**让 `create` Remote 返回新的 `WorkspaceView`。** 否决，因为这会让 Host 以值方式 import workspace-controller 包，从而需要一个经过人工评审的 host dependency 例外。Client 改为等待权威的 Workspace stream 行，因此它渲染的行与其他所有界面读取的行是同一行。

## 后果

worktree Session 就是普通 Session：它的日志、归档、重命名与分叉和其他 Session 一样，其改动无需离开 GUI 即可被审阅。代价是每个 worktree 一份检出，会在磁盘上复制仓库内容，并且在部署的 setup 命令运行之前没有依赖、没有被忽略的文件。未被复制的检出级环境状态仍然缺失，因此依赖未提交本地细节的仓库需要 setup 命令来重建它。

Merge 与 Discard 都是刻意且由用户发起的，这让父工作树保持可预测，但也意味着该功能不会自行落地任何工作。该功能提供的并发只是文件系统隔离：两个 worktree Session 仍可能产出在合并时冲突的改动，而冲突的 merge 会报告路径并 abort，而不是自行解决它们。

包测试针对真实的临时仓库覆盖创建、状态、merge 与移除；Client 侧固定在仓库的每文件 100% 覆盖率门禁上，另有一个回放的 assembled-Web 场景通过出厂组合驱动项目行入口，因此无法触达其 Remote 服务的 worktree 界面会直接使门禁失败，而不会不被察觉地通过。worktree Session 的 transcript 不变，因此没有任何 recorded-session snapshot 变化。subagent、workflow 调用与 Team member 的 worktree 隔离、自动创建 pull request，以及 submodule 或 Git LFS 初始化，都不属于本决策。

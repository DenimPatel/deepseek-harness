---
description: "面向宿主的 Git worktree 服务（ctx.gitWorktree），让并发会话各自获得同一仓库的隔离检出，涵盖创建、状态查看、合并与移除。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-worktree

[English](README.md) | 中文

## 概述

当多个会话必须同时编辑同一个项目时使用本包。每个会话都在仓库旁自己的链接 `git worktree` 中、在自己的分支上工作，因此编辑绝不会在同一个工作树中相互冲突，分支也仍是一份普通的评审产物。本服务负责创建这些检出、报告每个检出相对其基线已推进多少、将其中一个合并回去，并将其移除。它对模型不可见，也不会增加提示词或请求上下文开销，但要求宿主上安装 git，并依赖 `subprocess` 服务。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

让每个会话各自获得共享仓库的一份检出。本服务绝不改动持久状态：它观察 git 并报告观察到的事实，由调用方决定哪个目录成为工作区。

### 初始配置

本服务接受一个 subprocess 提供方，外加自身的配置。最小组合如下：

```yaml
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-workspace-worktree'
  config:
    branchPrefix: 'dsh/'
    copyGlobs:
      - '**/.env'
    setupCommand: pnpm install
```

| 字段 | 设置后的效果 | 未设置时的效果 |
|---|---|---|
| `worktreeRoot` | 存放所有已创建检出的目录 | 同级目录 `<repository parent>/<repository name>.worktrees` |
| `branchPrefix` | 添加到每个已创建分支名的前面 | 创建的分支不带前缀 |
| `copyGlobs` | 相对于仓库的 picomatch 模式，其匹配的已跟踪文件会被复制到新检出中 | 不复制任何内容 |
| `setupCommand` | 复制步骤完成后在新检出内运行的 shell 命令 | 不运行任何内容 |
| `gitExecutable` | 每次 git 命令调用的可执行文件 | `git`，通过 `PATH` 解析 |

setup 命令是来自 `cordis.yml` 的运维方配置。它在新检出自身的 shell 中运行；worktree 名与分支名绝不会传入其中。

### 创建与查看检出

从仓库的主 worktree 创建检出。该名称同时成为目录名，并在配合 `branchPrefix` 时成为分支名：

```text
// Host consumer code, after the composition above is loaded:
const probe = await ctx.gitWorktree.probe('/path/to/repo')
// { gitAvailable: true, isRepository: true, isMainWorktree: true, branch: 'main', head: '…', dirty: false }

const created = await ctx.gitWorktree.create({ repoPath: '/path/to/repo', name: 'fix-login' })
// { path: '/path/to/repo.worktrees/fix-login', branch: 'dsh/fix-login', baseRevision: '…' }

const status = await ctx.gitWorktree.status({ path: created.path, baseRef: 'main' })
// { dirty: false, changedFiles: [], commitsAhead: 0, commitsBehind: 0, conflicts: [] }
```

缺少 git 或路径不在仓库内时，`probe` 绝不失败：这些都会被作为事实报告，因此某个界面可以带原因地禁用自身，而不必回退到共享目录。`create` 则快速失败——`path-exists`、`branch-exists`、`unsupported-parent`、`invalid-name`、`not-a-repository`、`git-unavailable`、`create-failed`——而 `setupCommand` 失败会报告 `setup-failed`，同时保留该检出，因此会话仍可启动并由人工修复。

### 合并与移除

合并是显式操作，且拒绝让仓库停留在半合并状态。当父级工作树有未提交改动，或有合并、cherry-pick、revert、rebase 正在进行时，它会拒绝执行；冲突则在服务中止合并后作为结果而非异常报告：

```text
const result = await ctx.gitWorktree.merge({ repoPath: '/path/to/repo', branch: created.branch })
// { outcome: 'merged', targetRef: 'main', revision: '…' }
// { outcome: 'conflict', targetRef: 'main', conflicts: ['src/login.ts'] }
```

移除检出会一并移除其分支。非强制移除会拒绝存在未提交或未跟踪改动的检出；`force: true` 则会丢弃这些改动。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释本服务背后的设计决策，并指出实现这些决策的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **不使用 shell 的 argv。** 每次 git 调用都是通过 `ctx.subprocess` 传递的参数向量，绝不是 shell 字符串，也绝不使用 `ctx.shell`，因此 worktree 名或分支名不可能被重新解释为语法。名称在到达 git 之前会被归约为单个路径段（`[A-Za-z0-9._-]`，其他字符一律折叠为 `-`）。
- **只观察，不拥有。** 本服务不持有任何缓存，也不持有持久记录。机器上的任何其他东西都可能移除或移动某个检出，因此每次调用都按仓库当前状态读取。
- **隔离只有一个归属方。** 检出所占用的目录会在其中出现任何会话之前创建，因为会话的工作目录在创建时即已固定。检出由本包拥有；workspace 注册表则记录哪个目录属于哪个父级。
- **显式落地。** 合并是由调用方决定的、带有拒绝防护的操作，绝不是后台副作用；冲突会被中止，而不是留在已暂存状态。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`GitWorktree` 服务、git argv 构造、worktree 操作 |
| [`src/types.ts`](src/types.ts) | 请求值、投影，以及 `GitWorktreeError` 失败错误码 |

### 失败错误码

每个错误码都对应一种不同的恢复方式：`invalid-name`、`path-exists` 与 `branch-exists` 需要换一个名称；`unsupported-parent` 需要改用仓库的主 worktree，而不是链接 worktree；`setup-failed` 会留下一个仍可用的检出；`parent-dirty` 与 `parent-busy` 需要先让父仓库恢复稳定；`merge-failed`、`create-failed` 与 `remove-failed` 报告 git 失败，其诊断信息在消息中。

### 不发布不变式伴生入口

本包不发布 `./invariant`。值得检查的关系——每条持久 worktree 记录都在其父仓库的 `git worktree list` 中有对应条目——跨越两个归属方：workspace 注册表持有持久记录，本服务观察 git。任何一方都无法观察到对方的另一半，因此该检查属于同时拥有两者的组合，而不是本包（[包不变式规则](../../AGENTS.md)）。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### worktree 检出

#### 模型看到什么

没有任何内容。`ctx.gitWorktree` 只服务于宿主侧消费方：本包不注册任何工具，不注入任何提示词，也不写入任何会话事件。在 worktree 中启动的会话看到的是一个普通工作目录；没有任何请求字段会提到本包。

#### Token 影响

每次请求的直接 token 用量为零。

#### KV Cache 影响

与实时请求无关：本包绝不触碰请求前缀，因此不会使提供方的缓存复用失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明 worktree 检出何时不合适，或何时需要特别的运维注意。它们是当前包约束，不是任务积压。

- **不初始化子模块与 Git LFS**——新建检出只得到 git 检出的工作树；需要显式拉取的子模块内容与大文件对象，在配置的 `setupCommand` 获取它们之前都不存在。
- **不自动落地**——没有任何东西会自行合并、删除或垃圾回收分支。合并与移除都是显式的调用方操作，被放弃的分支会一直累积，直到有人将其移除。
- **除前缀外不施加分支命名策略**——本服务只应用 `branchPrefix` 与名称 slug；自带命名规则的仓库需要调用方提供符合规则的名称。
- **检出只被观察，绝不被修复**——外部删除的 worktree 目录会让持久 workspace 记录原样保留；`status` 报告 `not-found`，由调用方决定是否忘记该记录。
- **会话状态随检出数量增长**——每个检出都是独立的工作目录，而会话持久化会为每个工作目录保留一个日志目录，因此每个检出都会在会话根目录下增加自己的状态。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

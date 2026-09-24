---
description: "Git worktree service (ctx.gitWorktree) for hosts giving concurrent sessions isolated checkouts of one repository, including creation, status, merge, and removal."
kind: "package-reference"
---

# @deepseek-ai/dsh-workspace-worktree

English | [中文](README.zh.md)

## Summary

Use this package when several sessions must edit one project at once. Each session works in its own linked `git worktree` beside the repository, on its own branch, so edits never collide in one working tree and the branch stays a normal review artifact. The service creates those checkouts, reports how far each has moved from its base, merges one back, and removes it. It is invisible to models and adds no prompt or request-context cost, but requires git on the host and the `subprocess` service.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Give each session its own checkout of a shared repository. The service never touches durable state: it observes git and reports what it finds, and the caller decides which directory becomes a workspace.

### Setting up

The service takes a subprocess provider plus its own configuration. A minimal composition:

```yaml
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-workspace-worktree'
  config:
    branchPrefix: 'dsh/'
    copyGlobs:
      - '**/.env'
    setupCommand: pnpm install
```

| Field | Effect when set | Effect when unset |
|---|---|---|
| `worktreeRoot` | Directory holding every created checkout | The sibling `<repository parent>/<repository name>.worktrees` |
| `branchPrefix` | Prepended to every created branch name | Created branches are unprefixed |
| `copyGlobs` | Repository-relative picomatch patterns whose tracked files are copied into a new checkout | Nothing is copied |
| `setupCommand` | Shell command run inside a new checkout after the copy step | Nothing runs |
| `gitExecutable` | Executable invoked for every git command | `git`, resolved through `PATH` |

The setup command is operator configuration from `cordis.yml`. It runs in the new checkout's own shell; worktree and branch names never reach it.

### Creating and inspecting checkouts

Create a checkout from the repository's main worktree. The name becomes both the directory name and, with `branchPrefix`, the branch name:

```text
// Host consumer code, after the composition above is loaded:
const probe = await ctx.gitWorktree.probe('/path/to/repo')
// { gitAvailable: true, isRepository: true, isMainWorktree: true, branch: 'main', head: '…', dirty: false }

const created = await ctx.gitWorktree.create({ repoPath: '/path/to/repo', name: 'fix-login' })
// { path: '/path/to/repo.worktrees/fix-login', branch: 'dsh/fix-login', baseRevision: '…' }

const status = await ctx.gitWorktree.status({ path: created.path, baseRef: 'main' })
// { dirty: false, changedFiles: [], commitsAhead: 0, commitsBehind: 0, conflicts: [] }
```

`probe` never fails for a missing git or a path outside a repository: those are reported facts, so a surface can disable itself with a reason instead of falling back to a shared directory. `create` fails loud — `path-exists`, `branch-exists`, `unsupported-parent`, `invalid-name`, `not-a-repository`, `git-unavailable`, `create-failed` — and a failing `setupCommand` reports `setup-failed` while keeping the checkout, so a session can still start and be repaired by hand.

### Merging and removing

Merge is explicit and refuses to leave the repository half-merged. It refuses while the parent tree is dirty or a merge, cherry-pick, revert, or rebase is in progress, and a conflict is reported as a result rather than an exception, after the service aborts the merge:

```text
const result = await ctx.gitWorktree.merge({ repoPath: '/path/to/repo', branch: created.branch })
// { outcome: 'merged', targetRef: 'main', revision: '…' }
// { outcome: 'conflict', targetRef: 'main', conflicts: ['src/login.ts'] }
```

Removing a checkout takes the branch with it. An unforced removal refuses a checkout with uncommitted or untracked changes; `force: true` discards them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the service and points at the code that realizes them; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **Shell-free argv.** Every git invocation is an argument vector through `ctx.subprocess`, never a shell string and never `ctx.shell`, so a worktree or branch name cannot be reinterpreted as syntax. A name is reduced to one path segment (`[A-Za-z0-9._-]`, everything else collapses to `-`) before it reaches git.
- **Observation, not ownership.** The service holds no cache and no durable record. A checkout can be removed or moved by anything else on the machine, so every call reads the repository as it is now.
- **One home for isolation.** The directory a checkout occupies is created before any session exists in it, because a session's working directory is fixed at creation. This package owns the checkout; the workspace registry records which directory belongs to which parent.
- **Explicit landing.** Merging is a caller decision with a refusal guard, never a background effect, and a conflict is aborted rather than left staged.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `GitWorktree` service, git argv construction, worktree operations |
| [`src/types.ts`](src/types.ts) | Request values, projections, and the `GitWorktreeError` failure codes |

### Failure codes

Each code is a distinct recovery: `invalid-name`, `path-exists`, and `branch-exists` need a different name; `unsupported-parent` needs the repository's main worktree instead of a linked one; `setup-failed` leaves a usable checkout; `parent-dirty` and `parent-busy` need the parent repository settled first; `merge-failed`, `create-failed`, and `remove-failed` report a git failure whose diagnostic is in the message.

### No invariant companion

No invariant companion is published: this package ships no `./invariant`. The relation worth checking — every durable worktree record has a matching entry in its parent repository's `git worktree list` — spans two owners: the workspace registry holds the durable records and this service observes git. Neither can observe the other's half, so the check belongs to the composition that owns both, not to this package ([package invariant rules](../../AGENTS.md)).

</details>

-----

<a id="model-experience"></a>
## Model Experience

### Worktree checkouts

#### What the model sees

Nothing. `ctx.gitWorktree` serves host-side consumers only: the package registers no tools, injects no prompts, and writes no session events. A session started in a worktree sees an ordinary working directory; no request field names this package.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the package never touches a request prefix, so it cannot invalidate provider cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when a worktree checkout is a poor fit or needs special operational care. They are current package constraints, not a task backlog.

- **Submodules and Git LFS are not initialized** — a new checkout gets the working tree git checks out; submodule contents and large-file objects that require an explicit fetch are absent until the configured `setupCommand` obtains them.
- **No automatic landing** — nothing merges, deletes, or garbage-collects a branch on its own. Merge and removal are explicit caller operations, and abandoned branches accumulate until someone removes them.
- **No branch-name policy beyond a prefix** — the service applies `branchPrefix` and the name slug only; a repository with its own naming rules needs the caller to supply a conforming name.
- **A checkout is observed, never repaired** — an externally removed worktree directory leaves the durable workspace record in place; `status` reports `not-found` and the caller decides whether to forget the record.
- **Session state grows per checkout** — each checkout is a distinct working directory, and session persistence keeps one directory of logs per working directory, so every checkout adds its own state under the session root.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

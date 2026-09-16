---
description: "Host worktree control: create, inspect, merge, and discard per-session git worktree checkouts and their Workspace registrations."
kind: "package-reference"
---
# Git Worktree Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-git-worktree-controller` owns the Host `ctx.gitWorktreeController` service and the generated Client `ctx.remote.gitWorktree` namespace. Its Remote methods observe a directory, create a linked worktree and register the Workspace that owns it, report one checkout's state, merge its branch into the parent repository, and discard the checkout with its registration. Use it through API Gateway when a Client must offer a user one isolated checkout per Session. The package carries no git logic of its own: every operation delegates to `ctx.gitWorktree`.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Host controller translates each `GitWorktreeError` the service raises into a `RemoteError` carrying a stable `git-worktree/*` code, so a Client renders a specific reason instead of a generic failure. `create` runs the git operation and then registers the Workspace, and the registration carries the descriptor in its single create write, so a failure never leaves a checkout registered without its origin. The returned value names only the new Workspace id, its path, and its branch, because the Workspace row itself arrives through the Workspace state stream; the Client resolves `create` after that authoritative row arrives rather than rendering a row it invented.

The Client entry provides `GitWorktreeCommandError`, which carries the `RemoteFailure`, and the `ctx.gitWorktrees` facade the worktree interface injects: `probe`, `create`, `status`, `merge`, and `discard`. `merge` separates a completed merge from a conflict, so a caller can list the conflicting paths and show that the parent tree is unchanged.

-----

<a id="model-experience"></a>
## Model Experience

None, as the worktree Remote namespace mutates host checkouts and registers no prompt, tool, schema, or Session event.

#### KV Cache effect

No direct effect; worktree operations change files on disk, never a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A create cannot be retried blindly** — the git step creates a directory and a branch before the Workspace registration, so a retry after an ambiguous failure fails on `path-exists` or `branch-exists` instead of completing the original request; a caller recovers by discarding or adopting the checkout that `probe` reports.
- **No cancellation** — a Remote call runs to completion, so a long `git worktree add` or a large configured copy cannot be aborted from the browser.
- **Checkout state is read on demand** — `status` and `merge` query the checkout's current git state rather than a cached projection, so a caller refreshes the counts it displays and learns about changes made outside the harness only at the next call.
- **Merging is local** — the namespace merges into the recorded parent repository and never contacts a remote, so pull requests and remote-branch cleanup are absent.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This package forwards `ctx.gitWorktree` results to Remote callers and owns no durable state; Workspace Registry owns the descriptor record.

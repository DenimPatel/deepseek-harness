# Agent Note: Per-session worktree checkouts for parallel edits

Status: implemented

English | [中文](2026-09-16-session-worktree-checkouts.zh.md)

## Problem

The Web GUI already runs several Session agents against one Workspace at the same time, but every Session in that Workspace shares one working tree. A Session's directory is frozen into its header when the Session is created, and that single directory drives the tool roots, the filesystem sandbox workspace root, Session persistence, and the cross-process write lease. Two Sessions editing one repository therefore overwrite each other's work. No lock fixes this: the write lease serializes writes to a Session log, not to the filesystem. Isolation has to exist before the Session does, because a Session's directory cannot change afterwards, so the feature had to create a checkout first and open the Session into it.

## Decision

A Session can be created in its own `git worktree`. `@deepseek-ai/dsh-workspace-worktree` (`packages/workspace/workspace-worktree`) owns `ctx.gitWorktree` and runs `git` through `ctx.subprocess` with argv arrays, never a shell string, so a branch name or path cannot inject a command.

Creating a worktree is one operation with two effects: `git worktree add -b <branch> <path> HEAD`, then a single Workspace record write carrying a `WorkspaceWorktree` descriptor. The descriptor holds `parentWorkspaceId`, `repoPath`, `branch`, `baseBranch`, and `baseRevision`, and its home is the Workspace domain, because the checkout is an ordinary Workspace whose path is the new directory. Session membership, Session persistence, and the sidebar feed therefore keep working unchanged through the existing path. The `workspace` domain version stays 2: the field is optional and absent in records written before it, so an upgrade reads them unchanged. `WorkspaceRegistry.createWorktree` writes the descriptor in its one create write rather than creating a plain record and patching it, so a failure never leaves a checkout registered without its origin. It also refuses to adopt a directory that is already registered as an ordinary Workspace, because the descriptor would be dropped silently and the checkout would render as a plain project with no merge or discard.

`@deepseek-ai/dsh-api-git-worktree-controller` (`packages/api/git-worktree-controller`) exposes the `gitWorktree` Remote namespace with `probe`, `create`, `status`, `merge`, and `discard`. Creating a checkout returns an id and a path, and the Client then opens a Session on the returned Workspace through the existing session-creation path, so there is still exactly one way to create a Session.

Defaults are derived, and every deployment-varying choice is a validated `Config` field: `worktreeRoot` (default `<repo>.worktrees` beside the repository), `branchPrefix` (unset leaves created branches unprefixed), `gitExecutable`, `setupCommand`, and `copyGlobs`. A fresh checkout has no dependency directory and no ignored files, so nothing is copied or installed unless the deployment configures it; a configured copy runs before the setup command, and a setup failure keeps the checkout and reports so the Session can still start and be repaired by hand.

`@deepseek-ai/dsh-client-ui-workspace-worktree` (`packages/client/ui-workspace-worktree`) owns the interface. It nests worktree rows under their project in the sidebar, adds the New-session-in-worktree entry beside the project row's New-session button, and renders the branch chip, changed-file counts, Merge, and Discard in the Session header. Grouping derives from the descriptor in `deriveGroups` (`packages/client/ui-workspace/src/client/tree.ts`), and a worktree whose parent Workspace is absent renders at the top level instead of disappearing.

## Landing changes explicitly

`merge` runs in the parent repository only when its working tree is clean and no merge, revert, cherry-pick, or rebase is in progress. A conflicting merge reports the conflicted paths and then aborts, so the parent tree is never left half-merged. `discard` removes the checkout and the Workspace registration but never Session history: Session logs are keyed by the checkout path under the harness home directory, and deleting the checkout leaves them readable.

## Alternatives considered

**Keep one working tree and serialize the writers.** Rejected because the existing write lease protects a Session log rather than the filesystem. Serializing tools would still lose edits made between a read and a write, and it would forbid the parallel work the feature exists to allow.

**Isolate subagents or Team members in worktrees instead.** Rejected for this change because a Team's shared checkout is a deliberate Team-domain decision, and worktree creation, branch naming, merge policy, ignored files, build artifacts, and cleanup are deployment choices there. This decision is user-initiated per Session and leaves the subagent and Team domains untouched; worktree isolation for a Team member remains open and is not implied by this note.

**Put the descriptor in the Session header or in a second storage domain.** The Session header is a durable Session format whose field set is frozen at creation, and this descriptor is a property of the Workspace, not of the Session. A second domain would split one fact across two owners and leave the sidebar to join two streams to know that a checkout belongs to a project.

**Auto-merge a worktree once its Session goes idle.** Rejected because it writes into the user's checkout without an explicit act, and a merge that lands while the user is reading the diff is worse than one more click.

**Place checkouts inside the repository or under the harness home directory.** A checkout inside the repository makes the parent Workspace's file watcher, search tools, and `git status` traverse a second full checkout, and it requires editing the user's ignore rules. Placing it under the home directory hides the checkout from the user's own tools and file manager. A sibling directory is outside the working tree, needs no ignore entry, and is reachable directly.

**Return the new `WorkspaceView` from the `create` Remote.** Rejected because it would make the Host value-import the workspace-controller package, which requires a reviewed host-dependency exception. The Client waits for the authoritative Workspace stream row instead, so the row it renders is the same row every other surface reads.

## Consequences

A worktree Session is an ordinary Session: it logs, archives, renames, and forks like any other, and its changes are visible to review without leaving the GUI. The cost is one checkout per worktree, which duplicates repository content on disk and starts without dependencies or ignored files until the deployment's setup command runs. Ambient per-checkout state that is not copied stays absent, so a repository that depends on uncommitted local detail needs the setup command to recreate it.

Merge and discard are deliberate and user-initiated, which keeps the parent tree predictable but means the feature never lands work on its own. The concurrency the feature provides is filesystem isolation only: two worktree Sessions can still produce changes that conflict when both are merged, and the conflicting merge reports paths and aborts rather than resolving them.

The package tests exercise creation, status, merge, and removal against real temporary repositories; the Client halves are pinned at the repository's per-file 100% coverage gate, and a replayed assembled-Web scenario drives the project-row entry through the shipped composition, so a worktree surface that cannot reach its Remote service fails the gate instead of passing unnoticed. A worktree Session's transcript is unchanged, so no recorded-session snapshot changes. Worktree isolation for subagents, workflow calls, and Team members, automatic pull-request creation, and submodule or Git LFS initialization are not part of this decision.

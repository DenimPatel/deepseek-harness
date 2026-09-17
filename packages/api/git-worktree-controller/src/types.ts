/**
 * Browser-safe request, result, and failure vocabulary for the `gitWorktree`
 * Remote namespace. The Client reads exactly these declarations; the Host
 * service's own vocabulary lives in `@deepseek-ai/dsh-workspace-worktree`.
 */

import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'

export type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No git executable answered on the Host. */
    'git-worktree/git-unavailable': Record<string, never>
    /** The named directory is not inside a git working tree. */
    'git-worktree/not-a-repository': { readonly path: string }
    /** The named Workspace is not a linked worktree. */
    'git-worktree/not-a-worktree': { readonly workspaceId: WorkspaceId }
    /** The worktree name has no characters usable in a path segment or branch. */
    'git-worktree/invalid-name': { readonly workspaceId: WorkspaceId }
    /** A directory already occupies the worktree location. */
    'git-worktree/path-exists': { readonly workspaceId: WorkspaceId }
    /** The branch the worktree would use already exists. */
    'git-worktree/branch-exists': { readonly workspaceId: WorkspaceId }
    /** The named parent is itself a linked worktree. */
    'git-worktree/unsupported-parent': { readonly workspaceId: WorkspaceId }
    /** Git refused to create the worktree. */
    'git-worktree/create-failed': { readonly workspaceId: WorkspaceId }
    /** The worktree was created but its setup command failed. */
    'git-worktree/setup-failed': { readonly workspaceId: WorkspaceId }
    /** The parent working tree has uncommitted changes. */
    'git-worktree/parent-dirty': { readonly workspaceId: WorkspaceId }
    /** The parent repository has a merge, cherry-pick, revert, or rebase in progress. */
    'git-worktree/parent-busy': { readonly workspaceId: WorkspaceId }
    /** Git refused to merge the branch. */
    'git-worktree/merge-failed': { readonly workspaceId: WorkspaceId }
    /** Git refused to remove the worktree or delete its branch. */
    'git-worktree/remove-failed': { readonly workspaceId: WorkspaceId }
    /** The recorded worktree directory is gone. */
    'git-worktree/missing': { readonly workspaceId: WorkspaceId }
  }
}

/** Directory requested for a repository observation. */
export interface GitWorktreeProbeRequest {
  /** Absolute host directory to observe. */
  readonly path: string
}

/** One repository, worktree, or plain directory observation. */
export interface GitWorktreeProbeValue {
  /** A git executable answered on the Host. */
  readonly gitAvailable: boolean
  /** The directory is inside a git working tree. */
  readonly isRepository: boolean
  /** The directory is the repository's main worktree rather than a linked one. */
  readonly isMainWorktree: boolean
  /** Short branch name, or absent when HEAD is detached. */
  readonly branch?: string
  /** Full revision at HEAD, or absent for an unborn branch. */
  readonly head?: string
  /** The working tree has staged, unstaged, or untracked changes. */
  readonly dirty: boolean
  /** The configured setup command, absent when the deployment configured none. */
  readonly setupCommand?: string
}

/** Request for one new linked worktree under a registered Workspace. */
export interface GitWorktreeCreateRequest {
  /** Registered Workspace whose directory is the parent repository's main worktree. */
  readonly workspaceId: WorkspaceId
  /** Operator-supplied worktree name; also the branch suffix. */
  readonly name: string
  /** Revision or ref to cut from; absent uses the parent's HEAD. */
  readonly baseRef?: string
  /** Run the configured setup command; absent means yes. */
  readonly runSetup?: boolean
}

/** One created linked worktree, with the Workspace that now owns it. */
export interface GitWorktreeCreateValue {
  /**
   * Newly registered Workspace whose path is the checkout. The Workspace row
   * itself arrives through the Workspace state stream, which is its one
   * authoritative projection; callers that must display it wait for it there.
   */
  readonly workspaceId: WorkspaceId
  /** Absolute directory holding the checkout. */
  readonly path: string
  /** Branch created and checked out there. */
  readonly branch: string
}

/** Request for the working-tree state of one worktree Workspace. */
export interface GitWorktreeStatusRequest {
  /** Registered Workspace carrying a worktree descriptor. */
  readonly workspaceId: WorkspaceId
}

/** Working-tree state of one worktree relative to its recorded base branch. */
export interface GitWorktreeStatusValue {
  /** The recorded directory is gone. */
  readonly missing: boolean
  /** The checkout has staged, unstaged, or untracked changes. */
  readonly dirty: boolean
  /** Repository-relative changed paths. */
  readonly changedFiles: readonly string[]
  /** Commits on the worktree branch that the base branch does not reach. */
  readonly commitsAhead: number
  /** Commits on the base branch that the worktree branch does not reach. */
  readonly commitsBehind: number
  /** Unmerged paths left by an in-progress operation inside the checkout. */
  readonly conflicts: readonly string[]
}

/** Request to merge one worktree branch into its parent repository. */
export interface GitWorktreeMergeRequest {
  /** Registered Workspace carrying a worktree descriptor. */
  readonly workspaceId: WorkspaceId
}

/** Outcome of one merge attempt; a conflict leaves the parent tree unchanged. */
export interface GitWorktreeMergeValue {
  /** The branch merged and the parent advanced. */
  readonly merged: boolean
  /** Ref the branch merged into, or would have merged into. */
  readonly targetRef: string
  /** Conflicting repository-relative paths, empty unless `merged` is false. */
  readonly conflicts: readonly string[]
}

/** Request to remove one worktree checkout and its Workspace registration. */
export interface GitWorktreeDiscardRequest {
  /** Registered Workspace carrying a worktree descriptor. */
  readonly workspaceId: WorkspaceId
  /** Discard uncommitted and untracked changes instead of refusing. */
  readonly force: boolean
}

/** Receipt after one worktree Workspace is discarded. */
export interface GitWorktreeDiscardValue {
  /** The checkout, its branch, and the Workspace registration are gone. */
  readonly discarded: true
}

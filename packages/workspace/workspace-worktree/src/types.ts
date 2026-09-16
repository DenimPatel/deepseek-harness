/**
 * Public vocabulary of the git-worktree service: request values, projection
 * results, and the failure codes every operation reports. Types only — the
 * service implementation lives in `index.ts`.
 * @module @deepseek-ai/dsh-workspace-worktree/src/types
 */

/**
 * Why one git-worktree operation failed. Each code is a distinct recovery for
 * a caller: `path-exists` and `branch-exists` need a different name,
 * `unsupported-parent` needs a different parent, `setup-failed` leaves a
 * usable worktree behind, and the rest report the repository state that
 * blocked the operation.
 */
export type GitWorktreeFailure =
  | 'git-unavailable'
  | 'not-a-repository'
  | 'invalid-name'
  | 'path-exists'
  | 'branch-exists'
  | 'unsupported-parent'
  | 'not-found'
  | 'create-failed'
  | 'setup-failed'
  | 'parent-dirty'
  | 'parent-busy'
  | 'merge-failed'
  | 'remove-failed'

/** One repository, worktree, or working-tree directory observation. */
export interface GitWorktreeProbe {
  /** The configured git executable answered `--version` in this environment. */
  readonly gitAvailable: boolean
  /** The probed path is inside a git working tree. */
  readonly isRepository: boolean
  /** The probed path is the repository's main worktree rather than a linked one. */
  readonly isMainWorktree: boolean
  /** Short branch name, or `undefined` when HEAD is detached. */
  readonly branch: string | undefined
  /** Full revision at HEAD, or `undefined` when the repository has no commit yet. */
  readonly head: string | undefined
  /** The working tree has staged, unstaged, or untracked changes. */
  readonly dirty: boolean
  /** The configured setup command, absent when the deployment configured none. */
  readonly setupCommand: string | undefined
}

/** One repository listed by `git worktree list`. */
export interface GitWorktreeEntry {
  /** Absolute directory of this worktree's checkout. */
  readonly path: string
  /** Short checked-out branch, or `undefined` when detached. */
  readonly branch: string | undefined
  /** Full revision at this worktree's HEAD, or `undefined` for an unborn branch. */
  readonly head: string | undefined
  /** This entry is the repository's main worktree. */
  readonly isMain: boolean
}

/** Request for one new linked worktree. */
export interface GitWorktreeCreateRequest {
  /** Existing main-worktree directory of the parent repository. */
  readonly repoPath: string
  /** Operator-supplied worktree name; also the branch suffix. */
  readonly name: string
  /** Revision or ref to cut from. Defaults to the parent's `HEAD`. */
  readonly baseRef?: string
  /**
   * Run the configured `setupCommand` in the new checkout. Defaults to true;
   * `false` creates the checkout without running it.
   */
  readonly runSetup?: boolean
}

/** One created linked worktree. */
export interface GitWorktreeCreateValue {
  /** Absolute directory now holding the checkout. */
  readonly path: string
  /** Branch created and checked out there. */
  readonly branch: string
  /** Revision the branch was cut at. */
  readonly baseRevision: string
}

/** Working-tree state of one linked worktree relative to its base. */
export interface GitWorktreeStatus {
  /** The checkout has staged, unstaged, or untracked changes. */
  readonly dirty: boolean
  /** Repository-relative paths `git status --porcelain` reported. */
  readonly changedFiles: readonly string[]
  /** Commits on the worktree branch that `baseRef` does not reach. */
  readonly commitsAhead: number
  /** Commits on `baseRef` that the worktree branch does not reach. */
  readonly commitsBehind: number
  /** Unmerged paths left by an in-progress operation inside the worktree. */
  readonly conflicts: readonly string[]
}

/** Working-tree state request for one linked worktree. */
export interface GitWorktreeStatusRequest {
  /** Absolute directory of the linked worktree. */
  readonly path: string
  /** Revision or ref to compare against. */
  readonly baseRef: string
}

/** Merge of one worktree branch into the parent repository's target ref. */
export interface GitWorktreeMergeRequest {
  /** Main-worktree directory of the parent repository. */
  readonly repoPath: string
  /** Branch to merge from. */
  readonly branch: string
  /** Ref to merge into. Defaults to the parent's current branch. */
  readonly targetRef?: string
}

/**
 * Outcome of one merge attempt. A conflict is a reported result rather than a
 * failure: the service has already aborted the merge, so the parent tree is
 * exactly as it was and the caller can show which files disagreed.
 */
export type GitWorktreeMergeResult =
  | {
    /** The branch merged and the parent advanced. */
    readonly outcome: 'merged'
    /** Ref the branch merged into. */
    readonly targetRef: string
    /** Revision the target ref reached. */
    readonly revision: string
  }
  | {
    /** The merge stopped on conflicting paths and was aborted. */
    readonly outcome: 'conflict'
    /** Ref the branch would have merged into. */
    readonly targetRef: string
    /** Conflicting repository-relative paths, as `git diff --diff-filter=U` listed them. */
    readonly conflicts: readonly string[]
  }

/** Removal of one linked worktree and its branch. */
export interface GitWorktreeRemoveRequest {
  /** Main-worktree directory of the parent repository. */
  readonly repoPath: string
  /** Absolute directory of the linked worktree to remove. */
  readonly path: string
  /** Branch to delete after the checkout is gone. */
  readonly branch: string
  /** Discard uncommitted and untracked changes instead of refusing. */
  readonly force: boolean
}

/** Receipt after one linked worktree is removed. */
export interface GitWorktreeRemoveValue {
  /** The checkout and its branch are gone. */
  readonly removed: true
}

/**
 * Why one git-worktree operation failed, carrying the operation's own failure
 * code. Callers recover per code; the message is for logs and humans.
 */
export class GitWorktreeError extends Error {
  /**
   * @param code - Failure code naming the recovery the caller must take.
   * @param message - Human-readable cause, including the git diagnostic when one exists.
   * @param options - Standard error options carrying the underlying failure.
   */
  constructor(
    readonly code: GitWorktreeFailure,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'GitWorktreeError'
  }
}

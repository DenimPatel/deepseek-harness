/**
 * Git worktree service (`ctx.gitWorktree`): creates, inspects, merges, and
 * removes linked `git worktree` checkouts beside a repository so concurrent
 * Sessions can edit the same project without sharing one working tree.
 *
 * Every git invocation is a shell-free argv through `ctx.subprocess`, so a
 * worktree or branch name can never be reinterpreted as shell syntax. The
 * service owns no durable state: the workspace registry records which
 * directory is a worktree, and this service observes the repository.
 * @module @deepseek-ai/dsh-workspace-worktree
 */

import { copyFile, mkdir, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import picomatch from 'picomatch'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import z from '@deepseek-ai/schemastery'
import { GitWorktreeError } from './types.ts'
import type {
  GitWorktreeCreateRequest,
  GitWorktreeCreateValue,
  GitWorktreeEntry,
  GitWorktreeMergeRequest,
  GitWorktreeMergeResult,
  GitWorktreeProbe,
  GitWorktreeRemoveRequest,
  GitWorktreeRemoveValue,
  GitWorktreeStatus,
  GitWorktreeStatusRequest,
} from './types.ts'

export type * from './types.ts'
export { GitWorktreeError } from './types.ts'

/** Cordis plugin name. */
export const name = 'git-worktree'

/** This service observes git exclusively through the subprocess seam. */
export const inject = ['subprocess']

/**
 * Worktree service configuration. Every field is a deployment choice with no
 * encoded default: an unset `worktreeRoot` derives a sibling directory from
 * the repository, an unset `setupCommand`/`copyGlobs` runs nothing, and an
 * unset `branchPrefix` leaves created branches unprefixed.
 */
export interface Config {
  /**
   * Directory holding every worktree this service creates. Defaults to the
   * sibling `<repo parent>/<repo name>.worktrees`.
   */
  readonly worktreeRoot?: string
  /**
   * Shell command run inside a freshly created worktree, after `copyGlobs`.
   * Unset runs nothing; a failure keeps the worktree and reports
   * `setup-failed` so a Session can still start and be repaired by hand.
   * Operator configuration, never derived from a worktree or branch name.
   */
  readonly setupCommand?: string
  /**
   * Repository-relative glob patterns whose tracked files are copied into a
   * freshly created worktree. Unset copies nothing.
   */
  readonly copyGlobs?: string[]
  /** Prefix prepended to every created branch name. Unset adds none. */
  readonly branchPrefix?: string
  /** Git executable to invoke. Defaults to `git` resolved through `PATH`. */
  readonly gitExecutable?: string
}

/** Config with the empty-string and empty-list spellings of "unset" folded into one meaning. */
interface ResolvedConfig {
  readonly worktreeRoot: string | undefined
  readonly setupCommand: string | undefined
  readonly copyGlobs: string[] | undefined
  readonly branchPrefix: string | undefined
  readonly gitExecutable: string | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    gitWorktree: GitWorktree
  }
}

/** Bounded capture for every git invocation; git diagnostics are small. */
const OUTPUT_MAX_BYTES = 1_048_576
/** Grace period between terminating a git process and reporting it exited. */
const GRACE_MS = 30_000

/** One completed git invocation. */
interface GitOutcome {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
}

/**
 * Linked-worktree operations over one repository. The service holds no cache:
 * every call observes the repository as it is now, because a worktree can be
 * removed or checked out by anything else on the machine.
 */
export class GitWorktree extends Service {
  static inject = ['subprocess']

  /** Deployment choices; an empty string or empty list is the unset spelling. */
  static Config: z<Config> = z.object({
    worktreeRoot: z.string(),
    setupCommand: z.string(),
    copyGlobs: z.array(z.string()),
    branchPrefix: z.string(),
    gitExecutable: z.string(),
  })

  /** Validated config with the unset spelling resolved to `undefined` once. */
  private readonly config: ResolvedConfig

  /**
   * @param ctx - Host context carrying the subprocess seam.
   * @param config - Deployment choices; see {@link Config}.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'gitWorktree')
    this.config = {
      worktreeRoot: config.worktreeRoot === '' ? undefined : config.worktreeRoot,
      setupCommand: config.setupCommand === '' ? undefined : config.setupCommand,
      copyGlobs: config.copyGlobs?.length === 0 ? undefined : config.copyGlobs,
      branchPrefix: config.branchPrefix === '' ? undefined : config.branchPrefix,
      gitExecutable: config.gitExecutable === '' ? undefined : config.gitExecutable,
    }
  }

  /**
   * Observe one directory without mutating anything. Never throws for a
   * missing git or a non-repository path: those are reported facts.
   * @param path - Absolute directory to observe.
   * @returns what the directory currently is.
   */
  async probe(path: string): Promise<GitWorktreeProbe> {
    const absent: GitWorktreeProbe = {
      gitAvailable: false,
      isRepository: false,
      isMainWorktree: false,
      branch: undefined,
      head: undefined,
      dirty: false,
      setupCommand: this.config.setupCommand,
    }
    if (!(await this.gitAvailable(path))) return absent
    const inside = await this.runOrUndefined(['rev-parse', '--is-inside-work-tree'], path)
    // A bare repository answers `false` with exit code 0, so the printed fact
    // decides, not the exit code alone.
    if (inside === undefined || inside.exitCode !== 0 || inside.stdout.trim() !== 'true') {
      return { ...absent, gitAvailable: true }
    }

    const gitDir = await this.runOrUndefined(['rev-parse', '--absolute-git-dir'], path)
    const commonDir = await this.runOrUndefined(['rev-parse', '--path-format=absolute', '--git-common-dir'], path)
    const branch = await this.runOrUndefined(['symbolic-ref', '--quiet', '--short', 'HEAD'], path)
    const head = await this.runOrUndefined(['rev-parse', 'HEAD'], path)
    const status = await this.runOrUndefined(['status', '--porcelain'], path)
    const mainWorktree = gitDir?.exitCode === 0 && commonDir?.exitCode === 0
      && await sameDirectory(gitDir.stdout.trim(), commonDir.stdout.trim())
    return {
      gitAvailable: true,
      isRepository: true,
      isMainWorktree: mainWorktree,
      branch: branch?.exitCode === 0 ? branch.stdout.trim() : undefined,
      head: head?.exitCode === 0 ? head.stdout.trim() : undefined,
      dirty: status !== undefined && status.exitCode === 0 && status.stdout.trim() !== '',
      setupCommand: this.config.setupCommand,
    }
  }

  /**
   * Create one linked worktree under the configured root, on a new branch cut
   * from `baseRef`, then run the configured copy and setup steps.
   * @param request - parent repository, worktree name, and base revision.
   * @returns the created directory, branch, and base revision.
   * @throws GitWorktreeError with `git-unavailable`, `not-a-repository`,
   * `unsupported-parent`, `invalid-name`, `path-exists`, `branch-exists`,
   * `create-failed`, or `setup-failed`.
   */
  async create(request: GitWorktreeCreateRequest): Promise<GitWorktreeCreateValue> {
    const repoPath = await this.requireMainWorktree(request.repoPath)
    const slug = slugOf(request.name)
    const root = this.config.worktreeRoot ?? join(dirname(repoPath), `${basename(repoPath)}.worktrees`)
    const path = join(root, slug)
    if (await exists(path)) {
      throw new GitWorktreeError('path-exists', `worktree directory '${path}' already exists`)
    }
    const branch = `${this.config.branchPrefix ?? ''}${slug}`
    if ((await this.run(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoPath)).exitCode === 0) {
      throw new GitWorktreeError('branch-exists', `branch '${branch}' already exists in '${repoPath}'`)
    }
    const baseRef = request.baseRef ?? 'HEAD'
    const revision = await this.run(['rev-parse', '--verify', `${baseRef}^{commit}`], repoPath)
    if (revision.exitCode !== 0) {
      throw new GitWorktreeError(
        'create-failed',
        `cannot resolve base '${baseRef}' in '${repoPath}': ${revision.stderr.trim()}`,
      )
    }
    const baseRevision = revision.stdout.trim()

    await mkdir(root, { recursive: true })
    const added = await this.run(['worktree', 'add', '-b', branch, path, baseRef], repoPath)
    if (added.exitCode !== 0) {
      throw new GitWorktreeError(
        'create-failed',
        `git worktree add failed in '${repoPath}': ${added.stderr.trim()}`,
      )
    }

    await this.copyConfiguredFiles(repoPath, path)
    const setup = this.config.setupCommand
    if (setup !== undefined && setup !== '' && request.runSetup !== false) {
      const ran = await this.runShell(setup, path)
      if (ran.exitCode !== 0) {
        throw new GitWorktreeError(
          'setup-failed',
          `setup command failed in '${path}' with exit ${String(ran.exitCode)}: ${ran.stderr.trim()}`,
        )
      }
    }
    return { path, branch, baseRevision }
  }

  /**
   * List every worktree of one repository.
   * @param repoPath - Any directory inside the parent repository.
   * @returns one entry per registered worktree, in git's own order.
   * @throws GitWorktreeError when the path is not a repository.
   */
  async list(repoPath: string): Promise<GitWorktreeEntry[]> {
    await this.requireMainWorktree(repoPath)
    const listed = await this.run(['worktree', 'list', '--porcelain'], repoPath)
    if (listed.exitCode !== 0) {
      throw new GitWorktreeError('not-a-repository', `git worktree list failed: ${listed.stderr.trim()}`)
    }
    return parseWorktreeList(listed.stdout)
  }

  /**
   * Observe one linked worktree relative to a base revision.
   * @param request - worktree directory and the revision to compare against.
   * @returns working-tree changes plus ahead/behind counts.
   * @throws GitWorktreeError with `not-found` when the directory is gone.
   */
  async status(request: GitWorktreeStatusRequest): Promise<GitWorktreeStatus> {
    const path = resolve(request.path)
    if (!(await exists(path))) {
      throw new GitWorktreeError('not-found', `worktree directory '${path}' does not exist`)
    }
    const status = await this.run(['status', '--porcelain'], path)
    const changedFiles = status.stdout.split('\n')
      .map(line => line.slice(3).trim())
      .filter(line => line !== '')
    const counted = await this.run(
      ['rev-list', '--left-right', '--count', `${request.baseRef}...HEAD`],
      path,
    )
    const [behind, ahead] = counted.exitCode === 0
      ? counted.stdout.trim().split(/\s+/).map(value => Number.parseInt(value, 10))
      : [Number.NaN, Number.NaN]
    const conflicted = await this.run(['diff', '--name-only', '--diff-filter=U'], path)
    return {
      dirty: status.stdout.trim() !== '',
      changedFiles,
      commitsAhead: Number.isNaN(ahead) ? 0 : (ahead as number),
      commitsBehind: Number.isNaN(behind) ? 0 : (behind as number),
      conflicts: conflicted.stdout.split('\n').map(line => line.trim()).filter(line => line !== ''),
    }
  }

  /**
   * Merge one worktree branch into the parent repository's target ref. Refuses
   * while the parent tree is dirty or mid-operation, and aborts on conflict so
   * the parent is never left half-merged.
   * @param request - parent repository, branch, and optional target ref.
   * @returns whether the merge landed, or the conflicting paths.
   * @throws GitWorktreeError with `parent-dirty`, `parent-busy`, or `merge-failed`.
   */
  async merge(request: GitWorktreeMergeRequest): Promise<GitWorktreeMergeResult> {
    const repoPath = await this.requireMainWorktree(request.repoPath)
    const probe = await this.probe(repoPath)
    if (probe.dirty) {
      throw new GitWorktreeError(
        'parent-dirty',
        `refusing to merge into '${repoPath}': the parent working tree has uncommitted changes`,
      )
    }
    const busy = await this.pendingOperation(repoPath)
    if (busy !== undefined) {
      throw new GitWorktreeError(
        'parent-busy',
        `refusing to merge into '${repoPath}': a ${busy} is in progress`,
      )
    }
    const targetRef = request.targetRef ?? probe.branch
    if (targetRef === undefined) {
      throw new GitWorktreeError('merge-failed', `'${repoPath}' has a detached HEAD and no explicit target ref`)
    }
    if (probe.branch !== targetRef) {
      const checkedOut = await this.run(['checkout', targetRef], repoPath)
      if (checkedOut.exitCode !== 0) {
        throw new GitWorktreeError('merge-failed', `cannot check out '${targetRef}': ${checkedOut.stderr.trim()}`)
      }
    }
    const merged = await this.run(['merge', '--no-ff', request.branch], repoPath)
    if (merged.exitCode !== 0) {
      const conflicted = await this.run(['diff', '--name-only', '--diff-filter=U'], repoPath)
      const conflicts = conflicted.stdout.split('\n').map(line => line.trim()).filter(line => line !== '')
      if (conflicts.length === 0) {
        throw new GitWorktreeError(
          'merge-failed',
          `git merge '${request.branch}' failed in '${repoPath}': ${merged.stderr.trim()}`,
        )
      }
      const aborted = await this.run(['merge', '--abort'], repoPath)
      /* v8 ignore next 6 -- every reported conflict aborts; this keeps a parent that cannot abort from retaining a half-merged tree. */
      if (aborted.exitCode !== 0) {
        throw new GitWorktreeError(
          'merge-failed',
          `merge of '${request.branch}' conflicted and 'git merge --abort' also failed in '${repoPath}': `
          + aborted.stderr.trim(),
        )
      }
      return { outcome: 'conflict', targetRef, conflicts }
    }
    const head = await this.run(['rev-parse', 'HEAD'], repoPath)
    return { outcome: 'merged', targetRef, revision: head.stdout.trim() }
  }

  /**
   * Remove one linked worktree and its branch. The directory is removed first
   * and the branch second, so a failure never leaves a branch whose checkout
   * still exists.
   * @param request - parent repository, worktree directory, branch, and force.
   * @returns removal receipt.
   * @throws GitWorktreeError with `remove-failed`.
   */
  async remove(request: GitWorktreeRemoveRequest): Promise<GitWorktreeRemoveValue> {
    const repoPath = await this.requireMainWorktree(request.repoPath)
    const removed = await this.run(
      ['worktree', 'remove', ...request.force ? ['--force'] : [], request.path],
      repoPath,
    )
    if (removed.exitCode !== 0) {
      throw new GitWorktreeError(
        'remove-failed',
        `git worktree remove failed for '${request.path}': ${removed.stderr.trim()}`,
      )
    }
    const deleted = await this.run(['branch', '-D', request.branch], repoPath)
    if (deleted.exitCode !== 0) {
      throw new GitWorktreeError(
        'remove-failed',
        `worktree '${request.path}' was removed but branch '${request.branch}' could not be deleted: `
        + deleted.stderr.trim(),
      )
    }
    return { removed: true }
  }

  /** Resolve the configured executable and prove it answers in this environment. */
  private async gitAvailable(cwd: string): Promise<boolean> {
    try {
      await this.spawnCollect([await this.executable(), '--version'], cwd)
      return true
    } catch {
      // A missing executable, an unreadable one, or a failing spawn all mean
      // git is unusable here; `probe` reports that as a fact rather than failing.
      return false
    }
  }

  /** The absolute git executable, resolved through `PATH` when it is a bare name. */
  private async executable(): Promise<string> {
    const command = this.config.gitExecutable ?? 'git'
    if (isAbsolute(command)) {
      if (await exists(command)) return command
      throw new GitWorktreeError('git-unavailable', `git executable '${command}' was not found`)
    }
    try {
      return await this.ctx.subprocess.resolveExecutable(command)
    } catch (error) {
      if (error instanceof SubprocessExecutableNotFoundError) {
        throw new GitWorktreeError('git-unavailable', `git executable '${command}' was not found`, { cause: error })
      }
      throw error
    }
  }

  /** Require that `path` names the main worktree of a repository. */
  private async requireMainWorktree(path: string): Promise<string> {
    const repoPath = resolve(path)
    const probe = await this.probe(repoPath)
    if (!probe.gitAvailable) {
      throw new GitWorktreeError('git-unavailable', 'no git executable is available on this host')
    }
    if (!probe.isRepository) {
      throw new GitWorktreeError('not-a-repository', `'${repoPath}' is not inside a git working tree`)
    }
    if (!probe.isMainWorktree) {
      throw new GitWorktreeError(
        'unsupported-parent',
        `'${repoPath}' is itself a linked worktree; create worktrees from the main worktree`,
      )
    }
    return repoPath
  }

  /** Name the in-progress operation blocking the parent, when one is. */
  private async pendingOperation(repoPath: string): Promise<string | undefined> {
    for (const [marker, label] of [
      ['MERGE_HEAD', 'merge'],
      ['CHERRY_PICK_HEAD', 'cherry-pick'],
      ['REVERT_HEAD', 'revert'],
      ['REBASE_HEAD', 'rebase'],
    ] as const) {
      const located = await this.run(['rev-parse', '--path-format=absolute', '--git-path', marker], repoPath)
      /* v8 ignore next -- the git directory resolved in requireMainWorktree; keeps a repository vanishing mid-operation from throwing. */
      if (located.exitCode !== 0) continue
      const markerPath = located.stdout.trim()
      if (markerPath !== '' && await exists(resolve(repoPath, markerPath))) return label
    }
    return undefined
  }

  /** Copy every tracked file matching the configured globs into the worktree. */
  private async copyConfiguredFiles(repoPath: string, worktreePath: string): Promise<void> {
    const globs = this.config.copyGlobs ?? []
    if (globs.length === 0) return
    const listed = await this.run(['ls-files', '-z'], repoPath)
    if (listed.exitCode !== 0) {
      throw new GitWorktreeError('create-failed', `cannot list tracked files in '${repoPath}': ${listed.stderr.trim()}`)
    }
    const isMatch = matchFactory(globs)
    for (const relative of listed.stdout.split('\0')) {
      if (relative === '' || !isMatch(relative)) continue
      const source = join(repoPath, relative)
      const target = join(worktreePath, relative)
      if (!(await exists(source))) continue
      await mkdir(dirname(target), { recursive: true })
      await copyFile(source, target)
    }
  }

  /** Run one git command, mapping an absent executable to `git-unavailable`. */
  private async run(args: readonly string[], cwd: string): Promise<GitOutcome> {
    const executable = await this.executable()
    return await this.spawnCollect([executable, ...args], cwd)
  }

  /** Run one git command, reporting an absent executable as `undefined`. */
  private async runOrUndefined(args: readonly string[], cwd: string): Promise<GitOutcome | undefined> {
    try {
      return await this.run(args, cwd)
    } catch (error) {
      /* v8 ignore start -- probe proved the executable present; a git that disappears between calls is reported, anything else rethrows. */
      if (error instanceof GitWorktreeError) return undefined
      throw error
      /* v8 ignore stop */
    }
  }

  /**
   * Run the operator-configured setup command in the worktree's own shell.
   * The command string is deployment configuration from cordis.yml, never
   * built from a worktree or branch name.
   */
  private async runShell(command: string, cwd: string): Promise<GitOutcome> {
    /* v8 ignore start -- each platform lane runs one arm, so the other is dead per host. */
    const argv = process.platform === 'win32'
      ? ['cmd.exe', '/d', '/s', '/c', command]
      : ['/bin/sh', '-c', command]
    /* v8 ignore stop */
    return await this.spawnCollect(argv, cwd)
  }

  /** Spawn one argv with bounded capture and read both streams back. */
  private async spawnCollect(argv: readonly string[], cwd: string): Promise<GitOutcome> {
    const handle = this.ctx.subprocess.spawn({
      argv,
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: OUTPUT_MAX_BYTES },
        stderr: { maxBytes: OUTPUT_MAX_BYTES },
      },
      graceMs: GRACE_MS,
    })
    const outcome = await handle.done
    return {
      exitCode: outcome.exitCode,
      /* v8 ignore start -- bounded stdio always yields both collectors; the optional form only satisfies the seam type. */
      stdout: handle.collected.stdout?.readFrom(0).text ?? '',
      stderr: handle.collected.stderr?.readFrom(0).text ?? '',
      /* v8 ignore stop */
    }
  }
}

/** Whether two paths name the same directory after symlink resolution. */
async function sameDirectory(left: string, right: string): Promise<boolean> {
  /* v8 ignore next -- git prints a path whenever rev-parse exits 0; an empty one cannot name a directory. */
  if (left === '' || right === '') return false
  try {
    const [a, b] = await Promise.all([stat(left), stat(right)])
    return a.dev === b.dev && a.ino === b.ino
  } catch {
    // A missing git directory means git answered something this probe cannot
    // compare; the caller treats it as "not the main worktree".
    /* v8 ignore next -- both paths come from rev-parse in one repository, so a stat failure needs a directory removed between the calls. */
    return false
  }
}

/** Whether a path exists at all. */
async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    // Any stat failure means the path is not usable right now.
    return false
  }
}

/**
 * Reduce an operator-supplied worktree name to one path segment and branch
 * suffix. Everything outside the portable set collapses to `-`, so a name can
 * never escape the worktree root or reach git as syntax.
 */
function slugOf(name: string): string {
  const slug = name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').replace(/[-.]+$/, '')
  if (slug === '') {
    throw new GitWorktreeError('invalid-name', `worktree name '${name}' has no usable characters`)
  }
  return slug
}

/** Build a matcher for the configured copy globs. */
function matchFactory(globs: readonly string[]): (relative: string) => boolean {
  const matches = picomatch([...globs], { dot: true })
  return relative => matches(relative)
}

/** Parse `git worktree list --porcelain` records. */
function parseWorktreeList(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = []
  let path: string | undefined
  let head: string | undefined
  let branch: string | undefined
  let detached = false
  const flush = (): void => {
    if (path === undefined) return
    entries.push({ path, head, branch: detached ? undefined : branch, isMain: entries.length === 0 })
    path = undefined
    head = undefined
    branch = undefined
    detached = false
  }
  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      flush()
      path = line.slice('worktree '.length).trim()
    } else if (line.startsWith('HEAD ')) {
      head = line.slice('HEAD '.length).trim()
    } else if (line.startsWith('branch ')) {
      branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '')
    } else if (line.trim() === 'detached') {
      detached = true
    }
  }
  flush()
  return entries
}

export default GitWorktree

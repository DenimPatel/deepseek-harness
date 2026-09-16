/**
 * The git-worktree service against a real git and the real local subprocess
 * provider. These verify the world: argv reaches git uninterpreted, a linked
 * checkout is isolated from the parent, and merge refuses or aborts instead of
 * leaving the parent half-merged.
 */

import { execFile } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import GitWorktree, { GitWorktreeError } from '../src/index.ts'
import type { Config } from '../src/index.ts'

// Every case shells out to real git on a fresh repository; under the gate's
// concurrent suites those commands exceed Vitest's 5s default.
vi.setConfig({ testTimeout: 30_000 })

const run = promisify(execFile)

let root: string
let repo: string
let ctx: Context

/** Run git in the fixture repository and return trimmed stdout. */
async function git(args: readonly string[], cwd: string = repo): Promise<string> {
  const { stdout } = await run('git', [...args], { cwd })
  return stdout.trim()
}

/** Commit everything currently staged. */
async function commit(message: string): Promise<void> {
  await git(['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', message])
}

/** Absolute path of the git this host runs, for the configured-executable case. */
async function absoluteGit(): Promise<string> {
  const { stdout } = await run(process.platform === 'win32' ? 'where' : 'which', ['git'])
  const [located] = stdout.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
  if (located === undefined) throw new Error('git was not found on PATH')
  return located
}

/** Mount the service over the real local subprocess provider. */
async function mount(config: Config = {}): Promise<GitWorktree> {
  ctx = new Context()
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(GitWorktree, config)
  return ctx.gitWorktree
}

beforeEach(async () => {
  // git answers with resolved paths, so the fixture root must be resolved too.
  root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-worktree-')))
  repo = join(root, 'project')
  await mkdir(repo, { recursive: true })
  await git(['init', '-b', 'main'])
  await writeFile(join(repo, 'tracked.txt'), 'tracked\n')
  await mkdir(join(repo, '.config'), { recursive: true })
  await writeFile(join(repo, '.config', 'local.env'), 'SECRET=1\n')
  await git(['add', '.'])
  await commit('initial')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('probe', () => {
  it('reports a non-repository directory as available git without a worktree', async () => {
    const service = await mount()
    const plain = join(root, 'plain')
    await mkdir(plain)
    expect(await service.probe(plain)).toEqual({
      gitAvailable: true,
      isRepository: false,
      isMainWorktree: false,
      branch: undefined,
      head: undefined,
      dirty: false,
    })
  })

  it('reports the main worktree, its branch, head, and dirtiness', async () => {
    const service = await mount()
    const clean = await service.probe(repo)
    expect(clean).toMatchObject({
      gitAvailable: true,
      isRepository: true,
      isMainWorktree: true,
      branch: 'main',
      dirty: false,
    })
    expect(clean.head).toMatch(/^[0-9a-f]{40}$/)

    await writeFile(join(repo, 'tracked.txt'), 'changed\n')
    expect((await service.probe(repo)).dirty).toBe(true)
  })

  it('reports a linked worktree as a repository but not the main one', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'feature' })
    expect(await service.probe(created.path)).toMatchObject({
      isRepository: true,
      isMainWorktree: false,
      branch: 'dsh/feature',
      dirty: false,
    })
  })

  it('reports a bare repository as git without a working tree', async () => {
    const service = await mount()
    const bare = join(root, 'bare.git')
    await git(['init', '--bare', bare])
    // `rev-parse --is-inside-work-tree` exits 0 and prints `false` here, so the
    // printed fact decides rather than the exit code.
    expect(await service.probe(bare)).toEqual({
      gitAvailable: true,
      isRepository: false,
      isMainWorktree: false,
      branch: undefined,
      head: undefined,
      dirty: false,
    })
    await expect(service.create({ repoPath: bare, name: 'feature' }))
      .rejects.toMatchObject({ code: 'not-a-repository' })
  })

  it('reports git as unavailable when the configured executable does not exist', async () => {
    const service = await mount({ gitExecutable: join(root, 'no-such-git') })
    expect((await service.probe(repo)).gitAvailable).toBe(false)
    await expect(service.create({ repoPath: repo, name: 'feature' }))
      .rejects.toMatchObject({ code: 'git-unavailable' })
  })

  it('reports an absent setup command as undefined', async () => {
    const service = await mount({ setupCommand: '' })
    const plain = join(root, 'plain')
    await mkdir(plain)
    expect((await service.probe(plain)).setupCommand).toBeUndefined()
    expect((await service.probe(repo)).setupCommand).toBeUndefined()
  })

  it('reports a detached HEAD without a branch', async () => {
    const service = await mount()
    await git(['checkout', '--detach'])
    const probed = await service.probe(repo)
    expect(probed).toMatchObject({ isRepository: true, isMainWorktree: true, branch: undefined })
    expect(probed.head).toMatch(/^[0-9a-f]{40}$/)
  })

  it('reports a repository with no commits as having no head', async () => {
    const service = await mount()
    const empty = join(root, 'empty')
    await mkdir(empty)
    await git(['init', '-b', 'main'], empty)
    expect(await service.probe(empty)).toMatchObject({
      gitAvailable: true,
      isRepository: true,
      isMainWorktree: true,
      branch: 'main',
      head: undefined,
      dirty: false,
    })
  })

  it('accepts an absolute path to a real git executable', async () => {
    const service = await mount({ gitExecutable: await absoluteGit() })
    expect(await service.probe(repo)).toMatchObject({
      gitAvailable: true,
      isRepository: true,
      isMainWorktree: true,
      branch: 'main',
    })
  })

  it('reports git as unavailable for a bare name that is not on PATH', async () => {
    const service = await mount({ gitExecutable: 'dsh-definitely-absent-git' })
    expect((await service.probe(repo)).gitAvailable).toBe(false)
    await expect(service.list(repo)).rejects.toMatchObject({ code: 'git-unavailable' })
  })

  it('reports git as unavailable when the resolver rejects a relative executable', async () => {
    const service = await mount({ gitExecutable: './relative-git' })
    expect((await service.probe(repo)).gitAvailable).toBe(false)
  })
})

describe('create', () => {
  it('cuts a sibling worktree directory on a new branch from HEAD', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'Feature One' })
    expect(created.path).toBe(join(root, 'project.worktrees', 'Feature-One'))
    expect(created.branch).toBe('dsh/Feature-One')
    expect(created.baseRevision).toBe(await git(['rev-parse', 'HEAD']))
    expect((await stat(created.path)).isDirectory()).toBe(true)
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'], created.path)).toBe('dsh/Feature-One')
    // The parent branch is untouched.
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main')
  })

  it('treats an empty config value as unset', async () => {
    const service = await mount({
      worktreeRoot: '',
      setupCommand: '',
      copyGlobs: [],
      branchPrefix: '',
      gitExecutable: '',
    })
    const created = await service.create({ repoPath: repo, name: 'Empty Spelling', runSetup: false })
    // The empty spellings fall back to the sibling root, no prefix, no setup,
    // and git resolved through PATH.
    expect(created.path).toBe(join(root, 'project.worktrees', 'Empty-Spelling'))
    expect(created.branch).toBe('Empty-Spelling')
    expect((await service.probe(repo)).setupCommand).toBeUndefined()
  })

  it('honours an explicit worktree root and base ref', async () => {
    const elsewhere = join(root, 'elsewhere')
    const service = await mount({ worktreeRoot: elsewhere, branchPrefix: 'dsh/' })
    await writeFile(join(repo, 'second.txt'), 'second\n')
    await git(['add', '.'])
    await commit('second')
    const first = await git(['rev-parse', 'HEAD~1'])
    const created = await service.create({ repoPath: repo, name: 'older', baseRef: 'HEAD~1' })
    expect(created.path).toBe(join(elsewhere, 'older'))
    expect(created.baseRevision).toBe(first)
  })

  it('copies configured tracked files without touching ignored ones', async () => {
    const service = await mount({ branchPrefix: 'dsh/', copyGlobs: ['**/*.env'] })
    const created = await service.create({ repoPath: repo, name: 'copy' })
    expect(await readFile(join(created.path, '.config', 'local.env'), 'utf8')).toBe('SECRET=1\n')
    expect(await stat(join(created.path, 'tracked.txt')).catch(() => undefined)).toBeDefined()
  })

  it('runs the configured setup command inside the new worktree', async () => {
    const service = await mount({ branchPrefix: 'dsh/', setupCommand: 'echo ready > setup.txt' })
    const created = await service.create({ repoPath: repo, name: 'setup' })
    expect(await readFile(join(created.path, 'setup.txt'), 'utf8')).toBe('ready\n')
  })

  it('keeps the worktree and reports setup-failed when the setup command fails', async () => {
    const service = await mount({ branchPrefix: 'dsh/', setupCommand: 'exit 3' })
    const failure = await service.create({ repoPath: repo, name: 'broken' })
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(GitWorktreeError)
    expect(failure).toMatchObject({ code: 'setup-failed' })
    expect((await stat(join(root, 'project.worktrees', 'broken'))).isDirectory()).toBe(true)
  })

  it('refuses a taken directory, a taken branch, and a linked worktree as parent', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'once' })
    await expect(service.create({ repoPath: repo, name: 'once' }))
      .rejects.toMatchObject({ code: 'path-exists' })

    await expect(service.create({ repoPath: created.path, name: 'nested' }))
      .rejects.toMatchObject({ code: 'unsupported-parent' })

    await rm(created.path, { recursive: true, force: true })
    await expect(service.create({ repoPath: repo, name: 'once' }))
      .rejects.toMatchObject({ code: 'branch-exists' })
  })

  it('refuses a name with no usable characters and a non-repository parent', async () => {
    const service = await mount()
    await expect(service.create({ repoPath: repo, name: '   ' }))
      .rejects.toMatchObject({ code: 'invalid-name' })
    const plain = join(root, 'plain')
    await mkdir(plain)
    await expect(service.create({ repoPath: plain, name: 'feature' }))
      .rejects.toMatchObject({ code: 'not-a-repository' })
    await expect(service.create({ repoPath: repo, name: 'feature', baseRef: 'no-such-ref' }))
      .rejects.toMatchObject({ code: 'create-failed' })
  })

  it('creates the worktree without running setup when runSetup is false', async () => {
    const service = await mount({ branchPrefix: 'dsh/', setupCommand: 'echo ran > setup.txt' })
    const created = await service.create({ repoPath: repo, name: 'skip-setup', runSetup: false })
    expect(await stat(join(created.path, 'setup.txt')).catch(() => undefined)).toBeUndefined()
  })

  it('tolerates a configured tracked file missing from the parent working tree', async () => {
    await writeFile(join(repo, 'vanished.txt'), 'vanished\n')
    await git(['add', '.'])
    await commit('vanished')
    await rm(join(repo, 'vanished.txt'))
    const service = await mount({ branchPrefix: 'dsh/', copyGlobs: ['**/*.txt'] })
    const created = await service.create({ repoPath: repo, name: 'missing-copy' })
    // The checkout still carries the committed file; the copy step skips it.
    expect(await readFile(join(created.path, 'vanished.txt'), 'utf8')).toBe('vanished\n')
  })

  it('reports create-failed when the parent index cannot be listed', async () => {
    const service = await mount({ branchPrefix: 'dsh/', copyGlobs: ['**/*.txt'] })
    const gitDir = await git(['rev-parse', '--absolute-git-dir'])
    await writeFile(join(gitDir, 'index'), 'not an index\n')
    await expect(service.create({ repoPath: repo, name: 'bad-index' }))
      .rejects.toMatchObject({ code: 'create-failed' })
  })

  it.skipIf(process.platform === 'win32')('reports create-failed when git cannot write the worktree directory', async () => {
    const locked = join(root, 'locked')
    await mkdir(locked)
    await chmod(locked, 0o555)
    const service = await mount({ worktreeRoot: locked })
    try {
      await expect(service.create({ repoPath: repo, name: 'blocked' }))
        .rejects.toMatchObject({ code: 'create-failed' })
    } finally {
      await chmod(locked, 0o755)
    }
  })
})

describe('list and status', () => {
  it('lists the main worktree first and every linked worktree after it', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'listed' })
    const entries = await service.list(repo)
    expect(entries[0]).toMatchObject({ isMain: true, branch: 'main' })
    expect(entries.map(entry => entry.path)).toContain(created.path)
    expect(entries.find(entry => entry.path === created.path)).toMatchObject({
      branch: 'dsh/listed',
      isMain: false,
    })
  })

  it('reports changes, ahead/behind counts, and missing directories', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'status' })
    expect(await service.status({ path: created.path, baseRef: 'main' })).toEqual({
      dirty: false,
      changedFiles: [],
      commitsAhead: 0,
      commitsBehind: 0,
      conflicts: [],
    })

    await writeFile(join(created.path, 'tracked.txt'), 'edited\n')
    await git(['add', '.'], created.path)
    await git(['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'work'], created.path)
    const ahead = await service.status({ path: created.path, baseRef: 'main' })
    expect(ahead.commitsAhead).toBe(1)
    expect(ahead.commitsBehind).toBe(0)
    expect(ahead.dirty).toBe(false)

    await writeFile(join(repo, 'other.txt'), 'other\n')
    await git(['add', '.'])
    await commit('other')
    expect((await service.status({ path: created.path, baseRef: 'main' })).commitsBehind).toBe(1)

    await writeFile(join(created.path, 'dirty.txt'), 'dirty\n')
    expect((await service.status({ path: created.path, baseRef: 'main' })).changedFiles).toEqual(['dirty.txt'])

    await rm(created.path, { recursive: true, force: true })
    await expect(service.status({ path: created.path, baseRef: 'main' }))
      .rejects.toMatchObject({ code: 'not-found' })
  })

  it('reports not-a-repository when git cannot list the worktrees', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const broken = join(root, 'broken-meta')
    await git(['worktree', 'add', '-q', '-b', 'broken-meta', broken, 'HEAD'])
    const gitDir = await git(['rev-parse', '--absolute-git-dir'])
    const [entry] = await readdir(join(gitDir, 'worktrees'))
    if (entry === undefined) throw new Error('expected a registered worktree')
    await writeFile(join(gitDir, 'worktrees', entry, 'commondir'), '/nonexistent/common\n')
    await expect(service.list(repo)).rejects.toMatchObject({ code: 'not-a-repository' })
  })

  it('lists a detached worktree without a branch', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const detachedPath = join(root, 'detached-wt')
    await git(['worktree', 'add', '-q', '--detach', detachedPath, 'HEAD'])
    const detached = (await service.list(repo)).find(entry => entry.path === detachedPath)
    expect(detached).toMatchObject({ branch: undefined, isMain: false })
    expect(detached?.head).toMatch(/^[0-9a-f]{40}$/)
  })

  it('reports zero ahead/behind when the base ref cannot be resolved', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'bad-base' })
    expect(await service.status({ path: created.path, baseRef: 'no-such-base' })).toEqual({
      dirty: false,
      changedFiles: [],
      commitsAhead: 0,
      commitsBehind: 0,
      conflicts: [],
    })
  })

  it('reports conflicts left by an operation stopped inside the worktree', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'conflicted' })
    await writeFile(join(created.path, 'tracked.txt'), 'worktree side\n')
    await git(['add', '.'], created.path)
    await git(['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'worktree'], created.path)
    await writeFile(join(repo, 'tracked.txt'), 'main side\n')
    await git(['add', '.'])
    await commit('main side')
    await expect(run('git', ['merge', 'main'], { cwd: created.path })).rejects.toBeDefined()
    const statused = await service.status({ path: created.path, baseRef: 'main' })
    expect(statused.conflicts).toEqual(['tracked.txt'])
    expect(statused.dirty).toBe(true)
  })
})

describe('merge', () => {
  it('merges a worktree branch into the parent target ref', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'merged' })
    await writeFile(join(created.path, 'feature.txt'), 'feature\n')
    await git(['add', '.'], created.path)
    await git(['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'feature'], created.path)

    const result = await service.merge({ repoPath: repo, branch: created.branch })
    expect(result).toMatchObject({ outcome: 'merged', targetRef: 'main' })
    expect(await readFile(join(repo, 'feature.txt'), 'utf8')).toBe('feature\n')
  })

  it('refuses while the parent tree is dirty', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'dirty-parent' })
    await writeFile(join(repo, 'tracked.txt'), 'uncommitted\n')
    await expect(service.merge({ repoPath: repo, branch: created.branch }))
      .rejects.toMatchObject({ code: 'parent-dirty' })
  })

  it('refuses while the parent has a merge in progress', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'busy-parent' })
    const gitDir = await git(['rev-parse', '--absolute-git-dir'])
    await writeFile(join(gitDir, 'MERGE_HEAD'), `${created.baseRevision}\n`)
    await expect(service.merge({ repoPath: repo, branch: created.branch }))
      .rejects.toMatchObject({ code: 'parent-busy' })
  })

  it('reports conflicting files and leaves the parent tree clean', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'conflict' })
    await writeFile(join(created.path, 'tracked.txt'), 'worktree side\n')
    await git(['add', '.'], created.path)
    await git(['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'worktree'], created.path)
    await writeFile(join(repo, 'tracked.txt'), 'parent side\n')
    await git(['add', '.'])
    await commit('parent')

    const result = await service.merge({ repoPath: repo, branch: created.branch })
    expect(result).toMatchObject({ outcome: 'conflict', targetRef: 'main' })
    expect(result.outcome === 'conflict' ? result.conflicts : []).toEqual(['tracked.txt'])
    // No half-landed merge: HEAD is the parent commit and nothing is staged.
    expect(await git(['status', '--porcelain'])).toBe('')
    expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('parent side\n')
  })

  it('checks out an explicit target ref before merging', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    await git(['branch', 'release'])
    const created = await service.create({ repoPath: repo, name: 'target' })
    await writeFile(join(created.path, 'release.txt'), 'release\n')
    await git(['add', '.'], created.path)
    await git(['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'release work'], created.path)

    const result = await service.merge({ repoPath: repo, branch: created.branch, targetRef: 'release' })
    expect(result).toMatchObject({ outcome: 'merged', targetRef: 'release' })
    expect(await git(['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('release')

    await expect(service.merge({ repoPath: repo, branch: created.branch, targetRef: 'no-such-ref' }))
      .rejects.toMatchObject({ code: 'merge-failed' })
  })

  it('reports merge-failed when the branch cannot be merged at all', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    await expect(service.merge({ repoPath: repo, branch: 'no-such-branch' }))
      .rejects.toMatchObject({ code: 'merge-failed' })
  })

  it('reports merge-failed for a detached parent without an explicit target ref', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'detached-parent' })
    await git(['checkout', '--detach'])
    await expect(service.merge({ repoPath: repo, branch: created.branch }))
      .rejects.toMatchObject({ code: 'merge-failed' })
  })

  it('refuses while the parent has a cherry-pick in progress', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'cherry-parent' })
    const gitDir = await git(['rev-parse', '--absolute-git-dir'])
    await writeFile(join(gitDir, 'CHERRY_PICK_HEAD'), `${created.baseRevision}\n`)
    await expect(service.merge({ repoPath: repo, branch: created.branch }))
      .rejects.toMatchObject({ code: 'parent-busy' })
  })
})

describe('remove', () => {
  it('removes the checkout and deletes its branch', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'gone' })
    expect(await service.remove({
      repoPath: repo,
      path: created.path,
      branch: created.branch,
      force: false,
    })).toEqual({ removed: true })
    expect(await stat(created.path).catch(() => undefined)).toBeUndefined()
    expect(await git(['branch', '--list', created.branch])).toBe('')
  })

  it('refuses a dirty worktree unless forced', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'forced' })
    await writeFile(join(created.path, 'scratch.txt'), 'scratch\n')
    await expect(service.remove({
      repoPath: repo,
      path: created.path,
      branch: created.branch,
      force: false,
    })).rejects.toMatchObject({ code: 'remove-failed' })
    expect(await service.remove({
      repoPath: repo,
      path: created.path,
      branch: created.branch,
      force: true,
    })).toEqual({ removed: true })
  })

  it('reports remove-failed when the branch cannot be deleted', async () => {
    const service = await mount({ branchPrefix: 'dsh/' })
    const created = await service.create({ repoPath: repo, name: 'missing-branch' })
    await expect(service.remove({
      repoPath: repo,
      path: created.path,
      branch: 'no-such-branch',
      force: false,
    })).rejects.toMatchObject({ code: 'remove-failed' })
    expect(await stat(created.path).catch(() => undefined)).toBeUndefined()
  })
})

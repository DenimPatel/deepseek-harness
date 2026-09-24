// @vitest-environment jsdom
/**
 * The three worktree surfaces as plain-prop components: the create dialog on
 * the Project row, the status/action decoration on one worktree row, and the
 * Session header control. Props are the owner share, the locale seat, and
 * injected Host callbacks — no Cordis, no renderer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  GitWorktreeCreateValue, GitWorktreeProbeValue, GitWorktreeStatusValue,
} from '@deepseek-ai/dsh-api-git-worktree-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  SessionHeaderWorktree, WorktreeCreateAction, WorktreeRowActions,
  type SessionHeaderWorktreeProps, type WorktreeCreateActionProps, type WorktreeRowActionsProps,
} from '../src/client/WorktreeActions.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh)
const TITLE = 'Project'
const WORKSPACE = 'ws-1'
const BRANCH = 'wt-1'
const SESSION = 'session-1'

const triggerName = t('action.new.aria', { name: TITLE })

function probeValue(over: Partial<GitWorktreeProbeValue> = {}): GitWorktreeProbeValue {
  return { gitAvailable: true, isRepository: true, isMainWorktree: true, dirty: false, ...over }
}

function statusValue(over: Partial<GitWorktreeStatusValue> = {}): GitWorktreeStatusValue {
  return { missing: false, dirty: false, changedFiles: [], commitsAhead: 0, commitsBehind: 0, conflicts: [], ...over }
}

function createValue(over: Partial<GitWorktreeCreateValue> = {}): GitWorktreeCreateValue {
  return { workspaceId: WORKSPACE as never, path: '/repo/wt', branch: 'fix-login', ...over }
}

function trigger(): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: triggerName })
}

/* ------------------------------------------------------------------ create */

function createProps(over: {
  probe?: (path: string) => Promise<GitWorktreeProbeValue>
  create?: (workspaceId: string, name: string, runSetup: boolean) => Promise<GitWorktreeCreateValue>
  startSessionInWorktree?: (workspaceId: string) => void
} = {}): WorktreeCreateActionProps {
  return {
    workspaceId: WORKSPACE,
    title: TITLE,
    cwd: '/repo',
    t,
    probe: over.probe ?? vi.fn(async () => probeValue()),
    create: over.create ?? vi.fn(async () => createValue()),
    startSessionInWorktree: over.startSessionInWorktree ?? vi.fn(),
  } as WorktreeCreateActionProps
}

describe('WorktreeCreateAction', () => {
  it('keeps the trigger available until a probe reports a blocker', async () => {
    render(<WorktreeCreateAction {...createProps()} />)
    expect(trigger().disabled).toBe(false)
    cleanup()

    const blockers: readonly [Partial<GitWorktreeProbeValue>, keyof typeof zh][] = [
      [{ gitAvailable: false, isRepository: true, isMainWorktree: true }, 'unavailable.git'],
      [{ gitAvailable: true, isRepository: false, isMainWorktree: true }, 'unavailable.notRepo'],
      [{ gitAvailable: true, isRepository: true, isMainWorktree: false }, 'unavailable.linked'],
    ]
    for (const [value, key] of blockers) {
      render(<WorktreeCreateAction {...createProps({ probe: vi.fn(async () => probeValue(value)) })} />)
      fireEvent.click(trigger())
      expect(await screen.findByText(zh[key])).toBeDefined()
      expect(trigger().disabled).toBe(true)
      expect(trigger().title).toBe(zh[key])
      expect(screen.queryByRole('dialog')).toBeNull()
      cleanup()
    }
  })

  it('shows a rejected probe instead of opening the dialog', async () => {
    render(<WorktreeCreateAction {...createProps({ probe: vi.fn(async () => { throw new Error('probe boom') }) })} />)
    fireEvent.click(trigger())
    expect(await screen.findByText('Error: probe boom')).toBeDefined()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the dialog and creates the worktree from the name and setup choice', async () => {
    const create = vi.fn(async () => createValue())
    const startSessionInWorktree = vi.fn()
    render(
      <WorktreeCreateAction
        {...createProps({
          probe: vi.fn(async () => probeValue({ branch: 'main', head: 'abc123', setupCommand: 'pnpm install' })),
          create,
          startSessionInWorktree,
        })}
      />,
    )
    fireEvent.click(trigger())
    await screen.findByRole('dialog')

    expect(screen.getByText(`${t('dialog.base')}: main`)).toBeDefined()
    expect(screen.getByText(`${t('dialog.branch')}: —`)).toBeDefined()
    expect(screen.getByText(t('dialog.setup', { command: 'pnpm install' }))).toBeDefined()
    const setup = screen.getByRole<HTMLInputElement>('checkbox')
    expect(setup.checked).toBe(true)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fix-login' } })
    expect(screen.getByText(`${t('dialog.branch')}: fix-login`)).toBeDefined()
    fireEvent.click(setup)
    expect(setup.checked).toBe(false)

    const submit = screen.getByRole<HTMLButtonElement>('button', { name: zh['dialog.create'] })
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    expect(create).toHaveBeenCalledWith(WORKSPACE, 'fix-login', false)
    expect(startSessionInWorktree).toHaveBeenCalledWith(WORKSPACE)
  })

  it('falls back from branch to head to HEAD for the base label', async () => {
    render(
      <WorktreeCreateAction
        {...createProps({ probe: vi.fn(async () => probeValue({ head: 'deadbeef' })) })}
      />,
    )
    fireEvent.click(trigger())
    await screen.findByRole('dialog')
    expect(screen.getByText(`${t('dialog.base')}: deadbeef`)).toBeDefined()
    cleanup()

    render(
      <WorktreeCreateAction
        {...createProps({ probe: vi.fn(async () => probeValue()) })}
      />,
    )
    fireEvent.click(trigger())
    await screen.findByRole('dialog')
    expect(screen.getByText(`${t('dialog.base')}: HEAD`)).toBeDefined()
  })

  it('omits the setup option with no configured command and guards the create button', async () => {
    let resolveCreate!: (value: GitWorktreeCreateValue) => void
    const create = vi.fn(() => new Promise<GitWorktreeCreateValue>((resolve) => { resolveCreate = resolve }))
    render(<WorktreeCreateAction {...createProps({ create })} />)
    fireEvent.click(trigger())
    await screen.findByRole('dialog')

    expect(screen.queryByRole('checkbox')).toBeNull()
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: zh['dialog.create'] })
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fix-login' } })
    expect(submit.disabled).toBe(false)

    fireEvent.click(submit)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh['dialog.busy'] }).disabled).toBe(true)
    resolveCreate(createValue())
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })

  it('shows a rejected create inside the open dialog and opens no session', async () => {
    const startSessionInWorktree = vi.fn()
    render(
      <WorktreeCreateAction
        {...createProps({
          create: vi.fn(async () => { throw new Error('create boom') }),
          startSessionInWorktree,
        })}
      />,
    )
    fireEvent.click(trigger())
    await screen.findByRole('dialog')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fix-login' } })
    fireEvent.click(screen.getByRole('button', { name: zh['dialog.create'] }))

    expect(await screen.findByText('Error: create boom')).toBeDefined()
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(startSessionInWorktree).not.toHaveBeenCalled()
  })

  it('dismisses the dialog from the cancel action and the close control', async () => {
    render(<WorktreeCreateAction {...createProps()} />)
    fireEvent.click(trigger())
    await screen.findByRole('dialog')
    // The header close control precedes the body's cancel action in DOM order.
    fireEvent.click(screen.getAllByRole('button', { name: zh['dialog.cancel'] })[0]!)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })

    fireEvent.click(trigger())
    await screen.findByRole('dialog')
    const cancels = screen.getAllByRole('button', { name: zh['dialog.cancel'] })
    fireEvent.click(cancels[cancels.length - 1]!)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })
})

/* --------------------------------------------------------------------- row */

function rowProps(over: {
  status?: (workspaceId: string) => Promise<GitWorktreeStatusValue>
  merge?: (workspaceId: string) => Promise<{ merged: boolean; targetRef: string; conflicts: readonly string[] }>
  discard?: (workspaceId: string, force: boolean) => Promise<void>
  forgetWorkspace?: (workspaceId: string) => Promise<void>
} = {}): WorktreeRowActionsProps {
  return {
    workspaceId: WORKSPACE,
    branch: BRANCH,
    t,
    status: over.status ?? vi.fn(async () => statusValue()),
    merge: over.merge ?? vi.fn(async () => ({ merged: true, targetRef: 'refs/heads/main', conflicts: [] })),
    discard: over.discard ?? vi.fn(async () => undefined),
    forgetWorkspace: over.forgetWorkspace ?? vi.fn(async () => undefined),
  } as WorktreeRowActionsProps
}

describe('WorktreeRowActions', () => {
  it('shows the branch until refreshed, then the missing chip and its Forget action', async () => {
    const status = vi.fn(async () => statusValue({ missing: true }))
    const forgetWorkspace = vi.fn(async () => undefined)
    render(<WorktreeRowActions {...rowProps({ status, forgetWorkspace })} />)
    expect(screen.getByRole('button', { name: BRANCH })).toBeDefined()
    expect(screen.getByRole('button', { name: zh['menu.merge'] })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: BRANCH }))
    expect(await screen.findByText(zh['row.missing'])).toBeDefined()
    expect(status).toHaveBeenCalledWith(WORKSPACE)
    expect(screen.queryByRole('button', { name: zh['menu.merge'] })).toBeNull()
    expect(screen.queryByRole('button', { name: zh['menu.discard'] })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: zh['menu.forget'] }))
    await waitFor(() => { expect(forgetWorkspace).toHaveBeenCalledWith(WORKSPACE) })
  })

  it('renders the one-file, many-file, ahead, behind, and clean chips', async () => {
    const cases: readonly [GitWorktreeStatusValue, string][] = [
      [statusValue({ dirty: true, changedFiles: ['a.ts'] }), t('row.changes.one', { n: 1 })],
      [statusValue({ dirty: true, changedFiles: ['a.ts', 'b.ts'] }), t('row.changes.other', { n: 2 })],
      [statusValue({ commitsAhead: 2 }), t('row.ahead', { n: 2 })],
      [statusValue({ commitsBehind: 3 }), t('row.behind', { n: 3 })],
      [statusValue(), zh['row.clean']],
    ]
    for (const [value, label] of cases) {
      render(<WorktreeRowActions {...rowProps({ status: vi.fn(async () => value) })} />)
      fireEvent.click(screen.getByRole('button', { name: BRANCH }))
      expect(await screen.findByText(label)).toBeDefined()
      cleanup()
    }
  })

  it('shows a refresh failure beside the row', async () => {
    render(<WorktreeRowActions {...rowProps({ status: vi.fn(async () => { throw new Error('status boom') }) })} />)
    fireEvent.click(screen.getByRole('button', { name: BRANCH }))
    expect(await screen.findByText('Error: status boom')).toBeDefined()
  })

  it('merges on confirmation and refreshes after success', async () => {
    const status = vi.fn(async () => statusValue())
    const merge = vi.fn(async () => ({ merged: true, targetRef: 'refs/heads/main', conflicts: [] }))
    render(<WorktreeRowActions {...rowProps({ status, merge })} />)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.merge'] }))
    const dialog = await screen.findByRole('dialog')
    expect(screen.getByText(t('confirm.merge.body', { branch: BRANCH, target: t('dialog.base') }))).toBeDefined()

    fireEvent.click(within(dialog).getByRole('button', { name: zh['confirm.merge.confirm'] }))
    await waitFor(() => { expect(merge).toHaveBeenCalledWith(WORKSPACE) })
    await waitFor(() => { expect(status).toHaveBeenCalledWith(WORKSPACE) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(t('confirm.conflict', { files: 'a.ts, b.ts' }))).toBeNull()
  })

  it('reports a conflicting merge with the conflicting files', async () => {
    const merge = vi.fn(async () => ({ merged: false, targetRef: 'refs/heads/main', conflicts: ['a.ts', 'b.ts'] }))
    render(<WorktreeRowActions {...rowProps({ merge })} />)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.merge'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: zh['confirm.merge.confirm'] }))
    expect(await screen.findByText(t('confirm.conflict', { files: 'a.ts, b.ts' }))).toBeDefined()
  })

  it('shows a merge failure', async () => {
    render(<WorktreeRowActions {...rowProps({ merge: vi.fn(async () => { throw new Error('merge boom') }) })} />)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.merge'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: zh['confirm.merge.confirm'] }))
    expect(await screen.findByText('Error: merge boom')).toBeDefined()
  })

  it('confirms a discard with the refreshed uncommitted counts and clears on success', async () => {
    const status = vi.fn(async () => statusValue({ dirty: true, changedFiles: ['a.ts', 'b.ts'], commitsAhead: 1 }))
    const discard = vi.fn(async () => undefined)
    render(<WorktreeRowActions {...rowProps({ status, discard })} />)
    fireEvent.click(screen.getByRole('button', { name: BRANCH }))
    await screen.findByText(t('row.changes.other', { n: 2 }))

    fireEvent.click(screen.getByRole('button', { name: zh['menu.discard'] }))
    const dialog = await screen.findByRole('dialog')
    expect(screen.getByText(t('confirm.discard.body', { branch: BRANCH, files: 2, commits: 1 }))).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: zh['confirm.discard.confirm'] }))
    await waitFor(() => { expect(discard).toHaveBeenCalledWith(WORKSPACE, true) })
  })

  it('confirms a discard before any refresh with zero counts', async () => {
    render(<WorktreeRowActions {...rowProps()} />)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.discard'] }))
    await screen.findByRole('dialog')
    expect(screen.getByText(t('confirm.discard.body', { branch: BRANCH, files: 0, commits: 0 }))).toBeDefined()
  })

  it('shows a discard failure', async () => {
    render(<WorktreeRowActions {...rowProps({ discard: vi.fn(async () => { throw new Error('discard boom') }) })} />)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.discard'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: zh['confirm.discard.confirm'] }))
    expect(await screen.findByText('Error: discard boom')).toBeDefined()
  })

  it('dismisses a confirmation from cancel and from the close control', async () => {
    render(<WorktreeRowActions {...rowProps()} />)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.merge'] }))
    let dialog = await screen.findByRole('dialog')
    const cancels = within(dialog).getAllByRole('button', { name: zh['confirm.cancel'] })
    fireEvent.click(cancels[cancels.length - 1]!)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })

    fireEvent.click(screen.getByRole('button', { name: zh['menu.discard'] }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getAllByRole('button', { name: zh['confirm.cancel'] })[0]!)
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })
})

/* ------------------------------------------------------------------ header */

function worktreeWorkspace(over: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    workspaceId: WORKSPACE as never,
    path: '/repo/wt',
    title: 'wt',
    sessionIds: [SESSION as never],
    createdAt: '0',
    updatedAt: '0',
    worktree: {
      parentWorkspaceId: 'parent' as never,
      repoPath: '/repo',
      branch: BRANCH,
      baseBranch: 'main',
      baseRevision: 'abc',
    },
    ...over,
  }
}

function plainWorkspace(): WorkspaceView {
  return {
    workspaceId: WORKSPACE as never,
    path: '/repo/plain',
    title: 'plain',
    sessionIds: [SESSION as never],
    createdAt: '0',
    updatedAt: '0',
  }
}

function headerProps(over: {
  items?: readonly WorkspaceView[]
  running?: boolean
  status?: (workspaceId: string) => Promise<GitWorktreeStatusValue>
  merge?: (workspaceId: string) => Promise<{ merged: boolean; targetRef: string; conflicts: readonly string[] }>
  discard?: (workspaceId: string, force: boolean) => Promise<void>
} = {}): SessionHeaderWorktreeProps {
  const items = over.items ?? [worktreeWorkspace()]
  const running = over.running ?? false
  const workspacesState = { items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null }
  return {
    sessionId: SESSION,
    useWorkspaces: (selector: (state: unknown) => unknown) => selector(workspacesState),
    useSession: (selector: (state: unknown) => unknown) => selector({ running }),
    t,
    status: over.status ?? vi.fn(async () => statusValue()),
    merge: over.merge ?? vi.fn(async () => ({ merged: true, targetRef: 'refs/heads/main', conflicts: [] })),
    discard: over.discard ?? vi.fn(async () => undefined),
  } as SessionHeaderWorktreeProps
}

function headerControl(): HTMLElement {
  return screen.getByLabelText(t('header.aria', { branch: BRANCH })).parentElement as HTMLElement
}

describe('SessionHeaderWorktree', () => {
  it('renders nothing when the current session is not in a worktree workspace', () => {
    const cases: readonly (readonly WorkspaceView[])[] = [
      [],
      [plainWorkspace()],
      [worktreeWorkspace({ sessionIds: ['other' as never] })],
    ]
    for (const items of cases) {
      const { container } = render(<SessionHeaderWorktree {...headerProps({ items })} />)
      expect(container.innerHTML).toBe('')
      cleanup()
    }
  })

  it('renders the branch chip and controls, disabled while the session is running', () => {
    render(<SessionHeaderWorktree {...headerProps()} />)
    expect(screen.getByLabelText(t('header.aria', { branch: BRANCH }))).toBeDefined()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh['menu.merge'] }).disabled).toBe(false)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh['menu.discard'] }).disabled).toBe(false)
    cleanup()

    render(<SessionHeaderWorktree {...headerProps({ running: true })} />)
    const merge = screen.getByRole<HTMLButtonElement>('button', { name: zh['menu.merge'] })
    expect(merge.disabled).toBe(true)
    expect(merge.title).toBe(zh['header.disabled.sessionRunning'])
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh['menu.discard'] }).disabled).toBe(true)
  })

  it('disables the controls with the missing reason after a status refresh', async () => {
    const status = vi.fn(async () => statusValue({ missing: true }))
    render(<SessionHeaderWorktree {...headerProps({ status })} />)
    fireEvent.pointerOver(headerControl())
    await waitFor(() => {
      expect(screen.getByRole<HTMLButtonElement>('button', { name: zh['menu.merge'] }).disabled).toBe(true)
    })
    expect(screen.getByRole<HTMLButtonElement>('button', { name: zh['menu.merge'] }).title)
      .toBe(zh['header.disabled.missing'])
    expect(status).toHaveBeenCalledWith(WORKSPACE)
  })

  it('merges and refreshes after success', async () => {
    const status = vi.fn(async () => statusValue())
    const merge = vi.fn(async () => ({ merged: true, targetRef: 'refs/heads/main', conflicts: [] }))
    render(<SessionHeaderWorktree {...headerProps({ status, merge })} />)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.merge'] }))
    await waitFor(() => { expect(merge).toHaveBeenCalledWith(WORKSPACE) })
    await waitFor(() => { expect(status).toHaveBeenCalledWith(WORKSPACE) })
  })

  it('discards and refreshes after success', async () => {
    const status = vi.fn(async () => statusValue())
    const discard = vi.fn(async () => undefined)
    render(<SessionHeaderWorktree {...headerProps({ status, discard })} />)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.discard'] }))
    await waitFor(() => { expect(discard).toHaveBeenCalledWith(WORKSPACE, true) })
    await waitFor(() => { expect(status).toHaveBeenCalledWith(WORKSPACE) })
  })

  it('shows a refresh failure beside the header control', async () => {
    render(<SessionHeaderWorktree {...headerProps({ status: vi.fn(async () => { throw new Error('status boom') }) })} />)
    fireEvent.pointerOver(headerControl())
    expect(await screen.findByText('Error: status boom')).toBeDefined()
  })

  it('shows a merge failure and a discard failure', async () => {
    render(<SessionHeaderWorktree {...headerProps({ merge: vi.fn(async () => { throw new Error('merge boom') }) })} />)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.merge'] }))
    expect(await screen.findByText('Error: merge boom')).toBeDefined()
    cleanup()

    render(<SessionHeaderWorktree {...headerProps({ discard: vi.fn(async () => { throw new Error('discard boom') }) })} />)
    fireEvent.click(screen.getByRole('button', { name: zh['menu.discard'] }))
    expect(await screen.findByText('Error: discard boom')).toBeDefined()
  })
})

/**
 * Session-list projection hints are an explicit allowlist: only the keys the
 * list actually summarizes travel with every row, so a projection whose value
 * grows with the session (the activity histogram, the turn outline) stays a
 * per-Session read instead of multiplying the list payload. This spec pins both
 * directions: an allowlisted key arrives, and an unlisted registered wire key
 * does not.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { createSessionTestRemote, type TestSessionRemote } from './test-remote.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    'test/list-hint-marks': { marks: string[] }
    title: string | null
  }
  interface SessionProjectionMap {
    'test/list-hint-marks': { marks: string[] }
    title: string | null
  }
}

const ownedContexts = new Set<Context>()
afterEach(async () => {
  await Promise.all([...ownedContexts].map(ctx => ctx.fiber.dispose()))
  ownedContexts.clear()
})

/** Mount the list dependencies plus one allowlisted and one unlisted wire unit. */
async function harness(options: { readonly brokenHints?: boolean } = {}): Promise<{
  ctx: Context
  remote: TestSessionRemote
  attach: (session: Session) => Promise<void>
}> {
  const ctx = new Context()
  ownedContexts.add(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const remote = createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
    cwd: '/tmp',
  })
  // `title` is an allowlisted list hint; the broken variant makes reading it fail.
  ctx.sessionProjections.register<'title', string | null>({
    key: 'title',
    stateVersion: 1,
    stateSchema: z.string().nullable(),
    init: () => null,
    apply: (state, event) => event.type === 'turn/start' ? 'titled' : state,
    wire: {
      viewSchema: z.string().nullable(),
      view: options.brokenHints
        ? () => { throw new Error('title view failed') }
        : state => state,
    },
  })
  // `test/list-hint-marks` is a registered wire key the allowlist does not name.
  ctx.sessionProjections.register<'test/list-hint-marks', { marks: string[] }>({
    key: 'test/list-hint-marks',
    stateVersion: 1,
    stateSchema: z.object({ marks: z.array(z.string()) }).strict(),
    init: () => ({ marks: [] }),
    apply: (state, event) => event.type === 'turn/start' ? { marks: ['baseline'] } : state,
    wire: {
      viewSchema: z.object({ marks: z.array(z.string()) }).strict(),
      view: state => state,
    },
  })
  return {
    ctx,
    remote,
    attach: async (session) => {
      await ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    },
  }
}

/** The hint values one listed Session row carries. */
async function hintValues(
  remote: TestSessionRemote,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await remote.list({})
  if (!result.ok) throw new Error('list failed')
  return result.value.items.find(item => item.sessionId === id)?.projections?.values
}

describe('Session-list projection hints', () => {
  it('carries allowlisted keys and drops a registered key the allowlist does not name', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    await attach(session)
    session.append('turn/start', { turn: 1 })

    const values = await hintValues(remote, session.id)
    expect(values?.title).toBe('titled')
    expect(values?.sessionListMetadata).toMatchObject({ blank: false })
    expect(values).not.toHaveProperty('test/list-hint-marks')
  })

  it('admits every hint key only from the allowlist', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    await attach(session)
    session.append('turn/start', { turn: 1 })
    // The row carries exactly the allowlisted keys that hold a value; a newly
    // contributed projection key is absent until it is deliberately listed.
    expect(Object.keys(await hintValues(remote, session.id) ?? {}).sort())
      .toEqual(['modelSelection', 'sessionListMetadata', 'title'])
  })

  it('serves the row without hints when reading an allowlisted column fails', async () => {
    const { ctx, remote, attach } = await harness({ brokenHints: true })
    const session = ctx.sessions.create()
    await attach(session)
    session.append('turn/start', { turn: 1 })
    const result = await remote.list({})
    if (!result.ok) throw new Error('list failed')
    const row = result.value.items.find(item => item.sessionId === session.id)
    // The failure is contained: the row still lists, with no hint block.
    expect(row?.sessionId).toBe(session.id)
    expect(row?.projections).toBeUndefined()
  })
})

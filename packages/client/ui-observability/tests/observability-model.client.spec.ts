/**
 * Pure view-model folds: the sub-agent tree, the cross-session history rows,
 * and the empty-cut predicate.
 */
import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  buildAgentTree,
  buildHistoryRows,
  hasSessionFigures,
  sumBuckets,
} from '../src/client/observability-model.ts'

const ROOT = 'root' as SessionId
const CHILD = 'child' as SessionId
const GRANDCHILD = 'grandchild' as SessionId

function summary(id: SessionId, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id, updatedAt: 1, running: false, blank: false, displayTitle: `title:${id}`,
    ...over,
    retainedBy: over.retainedBy ?? {},
  }
}

function usage(input: number, output: number) {
  return { uncachedInputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0 }
}

describe('sumBuckets', () => {
  it('sums the four disjoint buckets', () => {
    expect(sumBuckets({ uncachedInputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 })).toBe(10)
  })
})

describe('buildAgentTree', () => {
  it('nests sub-agent children under the root in creation order', () => {
    const byId: Record<SessionId, SessionSummary> = {
      [ROOT]: summary(ROOT, { displayTitle: 'Root' }),
      [CHILD]: summary(CHILD, {
        parentId: ROOT,
        origin: 'subagent',
        running: true,
        updatedAt: 3,
        projectionValues: {
          tokenUsage: usage(10, 5),
          subagentTiming: { settledMs: 100, active: { since: 1000, through: 1200 } },
          subagent: { mode: 'continuable', label: 'Child', seq: 1 },
          modelSelection: { lastUsed: { provider: 'deepseek', model: 'v4' } },
        } as never,
      }),
      [GRANDCHILD]: summary(GRANDCHILD, {
        parentId: CHILD,
        origin: 'subagent',
        updatedAt: 4,
        projectionValues: { subagent: { mode: 'one-shot', seq: 2 } } as never,
      }),
    }
    const root = buildAgentTree(ROOT, byId, 1600)
    expect(root.label).toBe('Root')
    expect(root.mode).toBe('root')
    expect(root.children.map(child => child.id)).toEqual([CHILD])
    const child = root.children[0]
    expect(child?.mode).toBe('continuable')
    expect(child?.running).toBe(true)
    expect(child?.tokenTotal).toBe(15)
    // Active window adds (now - since) to the settled duration.
    expect(child?.durationMs).toBe(700)
    expect(child?.provider).toBe('deepseek')
    expect(child?.model).toBe('v4')
    expect(child?.children.map(node => node.id)).toEqual([GRANDCHILD])
    expect(child?.children[0]?.mode).toBe('one-shot')
  })

  it('synthesizes a root with no summary and no children', () => {
    const root = buildAgentTree(ROOT, {}, 0)
    expect(root).toMatchObject({ id: ROOT, label: ROOT, depth: 0, running: false, children: [] })
    expect(root.tokenTotal).toBeUndefined()
  })

  it('drops a summary with no identity projection to the one-shot mode', () => {
    const byId: Record<SessionId, SessionSummary> = {
      [ROOT]: summary(ROOT),
      [CHILD]: summary(CHILD, { parentId: ROOT, origin: 'subagent' }),
    }
    expect(buildAgentTree(ROOT, byId, 0).children[0]?.mode).toBe('one-shot')
  })
})

describe('buildHistoryRows', () => {
  it('excludes sub-agent and blank sessions and counts descendants', () => {
    const byId: Record<SessionId, SessionSummary> = {
      [ROOT]: summary(ROOT, {
        updatedAt: 5,
        projectionValues: { tokenUsage: usage(10, 5), sessionStats: { decodeMs: 250 } } as never,
      }),
      [CHILD]: summary(CHILD, { parentId: ROOT, origin: 'subagent' }),
      [GRANDCHILD]: summary(GRANDCHILD, { parentId: CHILD, origin: 'subagent' }),
      ['blank' as SessionId]: summary('blank' as SessionId, { blank: true }),
      ['ordinary' as SessionId]: summary('ordinary' as SessionId, { updatedAt: 9 }),
    }
    const rows = buildHistoryRows(byId)
    expect(rows.map(row => row.id)).toEqual(['ordinary', ROOT])
    expect(rows[1]).toMatchObject({ label: 'title:root', tokens: 15, durationMs: 250, subagentCount: 2 })
    expect(rows[0]?.subagentCount).toBe(0)
    expect(rows[0]?.durationMs).toBeUndefined()
  })
})

describe('hasSessionFigures', () => {
  it('is false with no values and true once tokens or steps arrive', () => {
    expect(hasSessionFigures(undefined, undefined)).toBe(false)
    expect(hasSessionFigures(usage(0, 0), { steps: 0, turns: 0 } as never)).toBe(false)
    expect(hasSessionFigures(usage(1, 0), undefined)).toBe(true)
    expect(hasSessionFigures(undefined, { steps: 1, turns: 0 } as never)).toBe(true)
  })
})

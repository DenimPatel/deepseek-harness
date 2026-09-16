/**
 * Pure view-model folds for the observability dashboard. Everything here is a
 * function over already-projected per-session values; no I/O, no transport, no
 * session access.
 */

// Type-only: merge the projection keys the session list and the tab body carry.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-session-stats/client'
import type {} from '@deepseek-ai/dsh-subagent/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'

/** Provider-reported token buckets, mirrored from the `tokenUsage` projection. */
export interface TokenBuckets {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
}

/** Whole-log counts and wall times, mirrored from the `sessionStats` projection. */
export interface SessionStatsFigures {
  readonly turns: number
  readonly steps: number
  readonly llmMs: number
  readonly toolMs: number
  readonly ttftMs: number
  readonly ttftSteps: number
  readonly decodeMs: number
  readonly decodeTokens: number
}

/** Occupancy numerator and denominator, mirrored from the `contextPressure` projection. */
export interface ContextFigures {
  readonly projectedTokens?: number
  readonly pressureTokens?: number
  readonly contextWindow?: number
}

/** The provider/model pair the latest request consumed. */
export interface ModelFigures {
  readonly provider: string
  readonly model: string
}

/** Identity mode of one tree node: the root session or a durable sub-agent child. */
export type AgentNodeMode = 'root' | 'one-shot' | 'continuable'

/** One node of the session's sub-agent tree. */
export interface AgentTreeNode {
  readonly id: SessionId
  readonly label: string
  readonly depth: number
  readonly running: boolean
  readonly mode: AgentNodeMode
  readonly tokenTotal?: number
  readonly durationMs?: number
  readonly provider?: string
  readonly model?: string
  readonly children: readonly AgentTreeNode[]
}

/** One row of the cross-session history. */
export interface HistoryRow {
  readonly id: SessionId
  readonly label: string
  readonly updatedAt: number
  readonly tokens: number
  readonly durationMs?: number
  readonly subagentCount: number
}

/** Session summaries keyed by id, as the session list serves them. */
export type SessionSummaries = Readonly<Record<SessionId, SessionSummary>>

function subagentDurationMs(summary: SessionSummary, now: number): number | undefined {
  const timing = summary.projectionValues?.subagentTiming
  if (timing === undefined) return undefined
  return timing.settledMs + (timing.active === undefined ? 0 : Math.max(0, now - timing.active.since))
}

function modelFigures(summary: SessionSummary | undefined): { provider?: string; model?: string } {
  const lastUsed = summary?.projectionValues?.modelSelection?.lastUsed
  if (lastUsed === undefined || lastUsed === null) return {}
  return { provider: lastUsed.provider, model: lastUsed.model }
}

/**
 * Build the root session's complete sub-agent tree in pre-order.
 * @param rootId - the session whose tree is built.
 * @param byId - every listed session summary.
 * @param now - wall-clock reading that resolves an open child's active duration.
 * @returns the root node with nested children.
 */
export function buildAgentTree(
  rootId: SessionId,
  byId: SessionSummaries,
  now: number,
): AgentTreeNode {
  const childrenOf = new Map<SessionId, SessionSummary[]>()
  for (const summary of Object.values(byId)) {
    if (summary.origin !== 'subagent' || summary.parentId === undefined) continue
    const siblings = childrenOf.get(summary.parentId)
    if (siblings === undefined) childrenOf.set(summary.parentId, [summary])
    else siblings.push(summary)
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id))
  }

  const visited = new Set<SessionId>()
  const build = (id: SessionId, depth: number): AgentTreeNode => {
    visited.add(id)
    const summary = byId[id]
    const children = (childrenOf.get(id) ?? [])
      .filter(child => !visited.has(child.id))
      .map(child => build(child.id, depth + 1))
    const identity = summary?.projectionValues?.subagent
    const mode: AgentNodeMode = depth === 0
      ? 'root'
      : identity == null ? 'one-shot' : identity.mode
    const tokenUsage = summary?.projectionValues?.tokenUsage
    return {
      id,
      label: summary?.displayTitle ?? id,
      depth,
      running: summary?.running ?? false,
      mode,
      ...tokenUsage === undefined ? {} : { tokenTotal: sumBuckets(tokenUsage) },
      ...(() => {
        const durationMs = summary === undefined ? undefined : subagentDurationMs(summary, now)
        return durationMs === undefined ? {} : { durationMs }
      })(),
      ...modelFigures(summary),
      children,
    }
  }
  return build(rootId, 0)
}

/**
 * Sum the four disjoint durable token buckets.
 * @param buckets - provider-reported buckets.
 * @returns the total token count.
 */
export function sumBuckets(buckets: TokenBuckets): number {
  return buckets.uncachedInputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

function countDescendants(id: SessionId, byId: SessionSummaries): number {
  let count = 0
  const stack: SessionId[] = [id]
  const seen = new Set<SessionId>()
  while (stack.length > 0) {
    // The length guard proves one frame exists.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const current = stack.pop()!
    for (const summary of Object.values(byId)) {
      if (summary.origin !== 'subagent' || summary.parentId !== current || seen.has(summary.id)) continue
      seen.add(summary.id)
      count += 1
      stack.push(summary.id)
    }
  }
  return count
}

/**
 * Build the cross-session rows: root sessions only, sub-agent logs excluded so
 * they appear through their parent's tree instead of as peer history entries.
 * @param byId - every listed session summary.
 * @returns rows ordered newest-first.
 */
export function buildHistoryRows(byId: SessionSummaries): HistoryRow[] {
  return Object.values(byId)
    .filter(summary => summary.origin !== 'subagent' && !summary.blank)
    .map((summary): HistoryRow => {
      const tokenUsage = summary.projectionValues?.tokenUsage
      const decodeMs = summary.projectionValues?.sessionStats?.decodeMs
      return {
        id: summary.id,
        label: summary.displayTitle,
        updatedAt: summary.updatedAt,
        tokens: tokenUsage === undefined ? 0 : sumBuckets(tokenUsage),
        ...decodeMs === undefined ? {} : { durationMs: decodeMs },
        subagentCount: countDescendants(summary.id, byId),
      }
    })
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
}

/**
 * Whether any dashboard value has arrived for the given cut.
 * @param usage - the session's cumulative token buckets, if served.
 * @param stats - the session's whole-log figures, if served.
 * @returns `true` when a token or step figure is non-zero.
 */
export function hasSessionFigures(
  usage: TokenBuckets | undefined,
  stats: SessionStatsFigures | undefined,
): boolean {
  if (usage !== undefined && sumBuckets(usage) > 0) return true
  return stats !== undefined && (stats.steps > 0 || stats.turns > 0)
}

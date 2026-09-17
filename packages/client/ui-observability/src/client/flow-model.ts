/**
 * Pure view-model folds for the Flow view: the Trajectory snapshot's records
 * regrouped into per-turn ledgers a person can read after pressing submit.
 *
 * The fold owns no copy: each row carries the locale key naming its role plus
 * the verbatim recorded data, and the component renders them. Nothing here
 * reaches the session; the Trajectory target already assembled the snapshot.
 */

import type {
  AssistantBlock,
  AssistantRequestConfig,
  ContextMessageNode,
  ConversationLocation,
  ConversationNode,
  ModelRetryNode,
  PartialAssistant,
  RequestView,
  RunningToolCall,
  SystemPromptNode,
  ToolCallBlock,
  ToolResultNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TrajectorySnapshot } from '@deepseek-ai/dsh-client-ui-trajectory/client'
import { cacheHitRatio } from './format.ts'
import type { TokenUsageBuckets } from './format.ts'
import type { ObservabilityKey } from './locales.ts'

/** Longest preview the ledger keeps on one line before it needs expansion. */
const PREVIEW_LIMIT = 120

/**
 * Sort key for records that have no log position yet: an in-flight row follows
 * every settled row of its turn.
 */
const PENDING_SEQ = Number.MAX_SAFE_INTEGER

/** How a request changed the prompt it inherited, when it logged a change. */
export type FlowPromptChange = 'initial' | 'system' | 'tools' | 'system-and-tools'

/** How one row reads: settled, failed, or still in flight. */
export type FlowRowState = 'ok' | 'error' | 'running'

/** One row of the under-the-hood ledger. */
export interface FlowRow {
  /** Stable React key, unique across every turn group. */
  readonly key: string
  /** Log sequence the row is anchored at; the ledger's sort key. */
  readonly seq: number
  /** Unix epoch ms of the anchoring record, or `0` for a row with no log position yet. */
  readonly time: number
  /** Owning turn, or `null` for records placed between turns. */
  readonly turn: number | null
  /** Owning step, or `null` when the record is turn-scoped. */
  readonly step: number | null
  /** Locale key naming the row's role. */
  readonly role: ObservabilityKey
  /** Verbatim business name: tool, command, producer, provider, or failure code. */
  readonly name?: string
  /** One-line preview of the recorded text. */
  readonly summary: string
  /** Exact recorded text or arguments, present when the preview is cut. */
  readonly detail?: string
  readonly state: FlowRowState
  /** Tool-catalog size the request carried. */
  readonly tools?: number
  /** Prompt change the request logged. */
  readonly change?: FlowPromptChange
  /** Reasoning text recorded alongside an assistant message. */
  readonly reasoning?: string
  /** Recorded request facts, present on a provider request row. */
  readonly request?: FlowRequestDetail
  /** Recorded tool material, present on a tool row. */
  readonly tool?: FlowToolDetail
}

/**
 * What one provider request recorded: its configuration, the prompt snapshot it
 * carried, and what it cost. Every field is optional because a compaction
 * request, a running request, and a window that holds no header each record a
 * different subset; the ledger shows only what exists.
 */
export interface FlowRequestDetail {
  /** Provider the request was issued to. */
  readonly provider?: string
  /** Model the request asked for. */
  readonly model?: string
  readonly temperature?: number
  readonly maxTokens?: number
  /** Thinking switch the request sent, when it set one. */
  readonly thinking?: string
  /** Reasoning-effort setting the request sent, when it set one. */
  readonly reasoningEffort?: string
  /** Offered tool catalog, by name; empty when the window holds no header. */
  readonly tools: readonly string[]
  /** Complete system prompt in force for the request. */
  readonly system?: string
  /** Wall time from issue to settlement, when the request settled. */
  readonly durationMs?: number
  /** Disjoint token buckets the settlement reported, when it reported any. */
  readonly tokens?: TokenUsageBuckets
  /** Cache-read share of billed prompt tokens, when the settlement reported billed input. */
  readonly cacheHitRatio?: number | null
  /** Retry ordinal this request ran as, as `n` or `n/max`, when it was a retry. */
  readonly retry?: string
}

/** Exact recorded material of one tool row: arguments, cut output, nested calls. */
export interface FlowToolDetail {
  /** Raw call arguments as recorded. */
  readonly arguments?: string
  /** Result text, present when the one-line preview cut it. */
  readonly output?: string
  /** Nested dispatch calls, each rendered as its recorded name and arguments. */
  readonly subCalls: readonly string[]
}

/** One turn's ledger, or the between-turns group when `turn` is `null`. */
export interface FlowTurn {
  readonly turn: number | null
  /** Earliest row seq in the group; the group's sort key. */
  readonly seq: number
  /** Earliest logged time in the group. */
  readonly time: number
  readonly rows: readonly FlowRow[]
  /** Rows recording a tool call or tool result. */
  readonly toolCalls: number
  /** Rows recording a user, steering, or assistant message. */
  readonly messages: number
}

/** One content block's text, or `''` for a block that carries none. */
function contentBlockText(block: ContextMessageNode['content'][number]): string {
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return block.text
    case 'tool-call':
      return block.name
    case 'tool-result':
      return block.content.map(contentBlockText).join(' ')
    default:
      return ''
  }
}

/** The joined text of one content-block list. */
function contentText(blocks: readonly ContextMessageNode['content'][number][]): string {
  return blocks.map(contentBlockText).filter(text => text !== '').join('\n')
}

/** The joined text of the assistant blocks of one kind; other kinds carry none. */
function assistantText(blocks: readonly AssistantBlock[], kind: 'text' | 'reasoning'): string {
  return blocks
    .flatMap(block => block.kind === kind ? [block.text] : [])
    .filter(text => text !== '')
    .join('\n')
}

/** Collapse one recorded text into a preview, keeping the exact text when it is cut. */
function preview(text: string): { summary: string; detail?: string } {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= PREVIEW_LIMIT) return { summary: collapsed }
  return { summary: `${collapsed.slice(0, PREVIEW_LIMIT)}…`, detail: text.trim() }
}

/** Resolve the turn and step of one record from the node, else from its location. */
function locate(
  seq: number,
  own: { turn?: number; step?: number },
  locations: ReadonlyMap<number, ConversationLocation>,
): { turn: number | null; step: number | null } {
  const location = locations.get(seq)
  if (location?.kind === 'step') return { turn: location.turn.turn, step: location.step.step }
  if (location?.kind === 'turn') return { turn: location.turn.turn, step: null }
  return { turn: own.turn ?? null, step: own.step ?? null }
}

/** One ledger row for a loaded system prompt. */
function systemPromptRow(prompt: SystemPromptNode): FlowRow {
  return {
    key: `system:${prompt.seq}`,
    seq: prompt.seq,
    time: prompt.time,
    turn: prompt.turn,
    step: prompt.step,
    role: 'flow.role.system',
    ...preview(prompt.text),
    state: 'ok',
  }
}

/** One nested dispatch call, as its recorded name and arguments. */
function subCallText(call: ToolCallBlock): string {
  if ('argsRaw' in call) return `${call.name} ${call.argsRaw}`.trim()
  return call.call === null ? call.callId : `${call.call.name} ${call.call.argsRaw}`.trim()
}

/** One ledger row for a tool result, paired with its call head when in-window. */
function toolResultRow(node: ToolResultNode, locations: ReadonlyMap<number, ConversationLocation>): FlowRow {
  const { turn, step } = locate(node.seq, {}, locations)
  const output = preview(contentText(node.content))
  const tool: FlowToolDetail = {
    ...node.call === null ? {} : { arguments: node.call.argsRaw },
    ...output.detail === undefined ? {} : { output: output.detail },
    subCalls: node.subCalls.map(subCallText),
  }
  const recorded = tool.arguments !== undefined || tool.output !== undefined || tool.subCalls.length > 0
  return {
    key: `tool:${node.seq}:${node.callId}`,
    seq: node.seq,
    time: node.time,
    turn,
    step,
    role: 'flow.role.tool',
    ...node.call === null ? {} : { name: node.call.name },
    summary: output.summary,
    state: node.isError ? 'error' : 'ok',
    ...recorded ? { tool } : {},
  }
}

/** One ledger row for a model-retry notice. */
function modelRetryRow(node: ModelRetryNode): FlowRow {
  return {
    key: `retry:${node.seq}`,
    seq: node.seq,
    time: node.time,
    turn: node.turn,
    step: node.step,
    role: 'flow.role.retry',
    name: node.provider,
    summary: node.failure.message,
    state: node.retryState === 'cancelled' ? 'ok' : 'running',
  }
}

/** One ledger row for a durable conversation node. */
function nodeRow(node: ConversationNode, locations: ReadonlyMap<number, ConversationLocation>): FlowRow {
  switch (node.kind) {
    case 'user': {
      const { turn, step } = locate(node.seq, {}, locations)
      return {
        key: `user:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn,
        step,
        role: 'flow.role.user',
        ...preview(contentText(node.content)),
        state: 'ok',
      }
    }
    case 'steering': {
      const { turn, step } = locate(node.seq, {}, locations)
      return {
        key: `steering:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn,
        step,
        role: 'flow.role.steering',
        ...preview(contentText(node.content)),
        state: 'ok',
      }
    }
    case 'context': {
      const { turn, step } = locate(node.seq, {}, locations)
      return {
        key: `context:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn,
        step,
        role: 'flow.role.context',
        name: node.producer.label ?? node.producer.role,
        ...preview(contentText(node.content)),
        state: 'ok',
      }
    }
    case 'assistant': {
      const reasoning = assistantText(node.blocks, 'reasoning')
      return {
        key: `assistant:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn: node.turn,
        step: node.step,
        role: 'flow.role.assistant',
        ...preview(assistantText(node.blocks, 'text')),
        state: node.interrupted === true ? 'error' : 'ok',
        ...reasoning === '' ? {} : { reasoning },
      }
    }
    case 'tool-result':
      return toolResultRow(node, locations)
    case 'command': {
      const { turn, step } = locate(node.seq, {}, locations)
      return {
        key: `command:${node.seq}:${node.commandId}`,
        seq: node.seq,
        time: node.time,
        turn,
        step,
        role: 'flow.role.command',
        ...node.name === null ? {} : { name: node.name },
        ...preview(node.outcome?.text ?? node.args ?? ''),
        state: node.outcome === null ? 'running' : node.outcome.kind === 'error' ? 'error' : 'ok',
      }
    }
    case 'compaction': {
      const { turn, step } = locate(node.seq, {}, locations)
      return {
        key: `compaction:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn,
        step,
        role: 'flow.role.compaction',
        ...preview(node.summary ?? ''),
        state: 'ok',
      }
    }
    case 'model-retry':
      return modelRetryRow(node)
    case 'turn-error':
      return {
        key: `turn-error:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn: node.turn,
        step: node.step,
        role: 'flow.role.error',
        ...node.code === undefined ? {} : { name: node.code },
        summary: node.message,
        state: 'error',
      }
    case 'turn-max-tokens':
      return {
        key: `max-tokens:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn: node.turn,
        step: node.step,
        role: 'flow.role.maxTokens',
        summary: '',
        state: 'ok',
      }
    // A surface event this UI version does not model still shows its type
    // instead of vanishing from the ledger.
    case 'unknown': {
      const { turn, step } = locate(node.seq, {}, locations)
      return {
        key: `unknown:${node.seq}`,
        seq: node.seq,
        time: node.time,
        turn,
        step,
        role: 'flow.role.unknown',
        name: node.type,
        summary: '',
        state: 'ok',
      }
    }
  }
}

/** One finite non-negative number, or null when the report is unusable. */
function nonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * The disjoint token buckets one settled request reported.
 * @param usage - the request record's optional usage value.
 * @returns uncached input, output, and cache buckets, or `undefined` when it reported neither input nor output.
 */
function usageTotals(usage: unknown): TokenUsageBuckets | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined
  const record = usage as Record<string, unknown>
  const input = nonNegative(record.inputTokens)
  const output = nonNegative(record.outputTokens)
  if (input === null && output === null) return undefined
  return {
    uncachedInputTokens: input ?? 0,
    outputTokens: output ?? 0,
    cacheReadTokens: nonNegative(record.cacheReadTokens) ?? 0,
    cacheWriteTokens: nonNegative(record.cacheWriteTokens) ?? 0,
  }
}

/**
 * The retry ordinal of one request, as `n` or `n/max`.
 * @param request - one assembled request record.
 * @returns the ordinal text, or `undefined` when the request was not a retry.
 */
function retryOrdinal(request: RequestView): string | undefined {
  if (request.purpose !== 'assistant' || request.retry === undefined) return undefined
  return request.maxRetries === undefined ? String(request.retry) : `${request.retry}/${request.maxRetries}`
}

/**
 * The recorded facts of one provider request.
 * @param request - one assembled request record.
 * @returns the detail, or `undefined` when the record carries nothing to show.
 */
function requestDetail(request: RequestView): FlowRequestDetail | undefined {
  const snapshot = request.purpose === 'assistant' ? request.prompt : undefined
  const config: AssistantRequestConfig | undefined = snapshot?.config ?? request.requestConfig
  const provider = request.providerMetadata?.provider ?? request.requestConfig?.provider
  const model = request.providerMetadata?.model ?? request.requestConfig?.model
  const tokens = usageTotals(request.usage)
  const retry = retryOrdinal(request)
  const system = snapshot === undefined || snapshot.system === '' ? undefined : snapshot.system
  // A request still in flight has no duration; a negative one is a clock skew.
  const durationMs = request.completedAt === null
    ? undefined
    : Math.max(0, request.completedAt - request.startedAt)
  const detail: FlowRequestDetail = {
    ...provider === undefined ? {} : { provider },
    ...model === undefined ? {} : { model },
    ...config?.temperature === undefined ? {} : { temperature: config.temperature },
    ...config?.maxTokens === undefined ? {} : { maxTokens: config.maxTokens },
    ...config?.thinking === undefined ? {} : { thinking: config.thinking },
    ...config?.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort },
    tools: (snapshot?.tools ?? []).map(tool => tool.name),
    ...system === undefined ? {} : { system },
    ...durationMs === undefined ? {} : { durationMs },
    ...tokens === undefined ? {} : { tokens, cacheHitRatio: cacheHitRatio(tokens) },
    ...retry === undefined ? {} : { retry },
  }
  const empty = detail.provider === undefined
    && detail.model === undefined
    && detail.tools.length === 0
    && detail.system === undefined
    && detail.durationMs === undefined
    && detail.tokens === undefined
    && detail.retry === undefined
    && detail.temperature === undefined
    && detail.maxTokens === undefined
    && detail.thinking === undefined
    && detail.reasoningEffort === undefined
  return empty ? undefined : detail
}

/** One ledger row for a provider request, carrying its prompt-change fact. */
function requestRow(request: RequestView): FlowRow {
  const provider = request.providerMetadata?.provider ?? request.requestConfig?.provider
  const model = request.providerMetadata?.model ?? request.requestConfig?.model ?? ''
  const tools = request.purpose === 'assistant' ? request.prompt?.tools.length : undefined
  const detail = requestDetail(request)
  return {
    key: `request:${request.startSeq}`,
    seq: request.startSeq,
    time: request.startedAt,
    turn: request.turn,
    step: request.step,
    role: 'flow.role.request',
    ...provider === undefined ? {} : { name: provider },
    summary: model,
    state: request.status === 'running' ? 'running' : request.status === 'error' ? 'error' : 'ok',
    ...tools === undefined ? {} : { tools },
    ...request.purpose === 'assistant' && request.promptChange !== undefined
      ? { change: request.promptChange.kind }
      : {},
    ...request.error === undefined ? {} : { detail: request.error },
    ...detail === undefined ? {} : { request: detail },
  }
}

/** One ledger row for the in-flight assistant output. */
function partialRow(partial: PartialAssistant): FlowRow {
  return {
    key: `partial:${partial.turn}:${partial.step}`,
    seq: PENDING_SEQ,
    time: 0,
    turn: partial.turn,
    step: partial.step,
    role: 'flow.role.assistant',
    ...preview(assistantText(partial.blocks, 'text')),
    state: 'running',
  }
}

/** One ledger row for a tool call whose result has not landed. */
function runningCallRow(call: RunningToolCall): FlowRow {
  return {
    key: `call:${call.callId}`,
    seq: PENDING_SEQ,
    time: 0,
    turn: call.turn,
    step: call.step,
    role: 'flow.role.tool',
    name: call.name,
    summary: '',
    state: 'running',
    detail: call.argsRaw,
  }
}

/** Earliest logged time in one group, or `0` while every row is still pending. */
function earliestTime(rows: readonly FlowRow[]): number {
  const logged = rows.filter(row => row.time > 0).map(row => row.time)
  return logged.length === 0 ? 0 : Math.min(...logged)
}

/** Group rows into one ordered ledger. */
function toTurn(turn: number | null, rows: readonly FlowRow[]): FlowTurn {
  const ordered = [...rows].sort((left, right) => left.seq - right.seq || left.key.localeCompare(right.key))
  return {
    turn,
    seq: Math.min(...ordered.map(row => row.seq)),
    time: earliestTime(ordered),
    rows: ordered,
    toolCalls: ordered.filter(row => row.role === 'flow.role.tool').length,
    messages: ordered.filter(row =>
      row.role === 'flow.role.user'
      || row.role === 'flow.role.steering'
      || row.role === 'flow.role.assistant').length,
  }
}

/** Sort rank of one turn group: numbered turns ascend, the between-turns group is last. */
function turnOrder(turn: number | null): number {
  return turn === null ? Number.MAX_SAFE_INTEGER : turn
}

/** Order two turn groups. */
function compareTurns(left: FlowTurn, right: FlowTurn): number {
  return turnOrder(left.turn) - turnOrder(right.turn)
}

/**
 * Give tool rows the turn and step in force where they sit.
 *
 * A tool row is assembled from the tool lifecycle rather than from a step
 * boundary, so its record states no turn and the snapshot's location map has no
 * entry for it. It still belongs to the step that issued it: the last
 * positioned record before it. Every other row keeps the turn its own record
 * states, including the `null` that marks a between-turns record.
 * @param rows - rows in any order.
 * @returns the rows in log order, each tool row holding the turn in force at its position.
 */
function attributeTurns(rows: readonly FlowRow[]): FlowRow[] {
  let turn: number | null = null
  let step: number | null = null
  const positioned: FlowRow[] = []
  for (const row of [...rows].sort((left, right) => left.seq - right.seq || left.key.localeCompare(right.key))) {
    if (row.turn === null) {
      positioned.push(row.role === 'flow.role.tool' ? { ...row, turn, step } : row)
      continue
    }
    // A new turn resets the step; within one turn a null step keeps the step in force.
    if (row.turn !== turn || row.step !== null) step = row.step
    turn = row.turn
    positioned.push({ ...row, step: row.step ?? step })
  }
  return positioned
}

/**
 * Group the Trajectory snapshot's records into readable turn ledgers.
 * @param snapshot - the assembled Trajectory snapshot for one session.
 * @returns one ledger per turn, oldest first, with the between-turns group last.
 */
export function buildFlow(snapshot: TrajectorySnapshot): FlowTurn[] {
  const rows: FlowRow[] = []
  for (const node of snapshot.eventNodes) rows.push(nodeRow(node, snapshot.eventLocations))
  for (const prompt of snapshot.systemPrompts ?? []) rows.push(systemPromptRow(prompt))
  for (const request of snapshot.requests) rows.push(requestRow(request))
  if (snapshot.partial !== null) rows.push(partialRow(snapshot.partial))
  for (const call of snapshot.runningCalls) rows.push(runningCallRow(call))

  const groups = new Map<number | null, FlowRow[]>()
  for (const row of attributeTurns(rows)) {
    const bucket = groups.get(row.turn)
    if (bucket === undefined) groups.set(row.turn, [row])
    else bucket.push(row)
  }
  return [...groups.entries()].map(([turn, groupRows]) => toTurn(turn, groupRows)).sort(compareTurns)
}

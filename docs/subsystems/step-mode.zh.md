# 单步执行模式

[English](step-mode.md) | 中文

[`@deepseek-ai/dsh-step-mode`](../../packages/interaction/step-mode) 让被武装的 Agent 在每个已配置的暂停点停下，直到面向人的应答者决定如何前进。浏览器半边是 [`@deepseek-ai/dsh-client-ui-step-mode`](../../packages/client/ui-step-mode)。

来源：[`packages/interaction/step-mode/src/types.ts`](../../packages/interaction/step-mode/src/types.ts)

## 公开类型

```ts type-equiv
/**
 * One configured pause point. `context` holds the agent after its step claimed
 * input and assembled the request, before the model request is prepared;
 * `tool` holds it before each tool dispatch, including `run_code` sub-calls.
 */
type StepBreakpoint = 'context' | 'tool'
```

```ts type-equiv
/**
 * How one pause resolves: `step` runs exactly this unit and pauses again at
 * the next pause point; `resume` runs the rest of the run without pausing.
 */
type StepAdvanceAction = 'step' | 'resume'
```

```ts type-equiv
/** Identity of the tool call a `tool` pause is holding, as far as the wire needs it. */
interface StepCallIdentity {
  /** The model-issued call identity. */
  readonly callId: string
  /** Registered tool name, e.g. `bash`. */
  readonly name: string
}
```

```ts type-equiv
/**
 * Client-safe payload of one pending pause. A UI reads it to name what is about
 * to run; the request itself never reaches a model.
 */
interface StepAdvanceRequestEvent {
  /** Agent identity projected to the corresponding Client Context in transit. */
  readonly agent: Agent
  /** Cancellation lifetime of the pending pause. */
  readonly signal?: AbortSignal
  /** Which pause point is holding the agent. */
  readonly breakpoint: StepBreakpoint
  /** Open turn whose unit is held. */
  readonly turn: number
  /** Step position of the held unit. */
  readonly step: number
  /** The held tool call, present exactly for the `tool` breakpoint. */
  readonly call?: StepCallIdentity
}
```

```ts type-equiv
/** The human's answer to one pending pause. */
interface StepAdvanceDecision {
  /** Whether to run only this unit or the rest of the run. */
  readonly action: StepAdvanceAction
}
```

## 事件：`step-mode/advance`

Agent 作用域的 waterfall。每次暂停都会分发被拦下的单元；应答者返回决策以认领该暂停，或调用 `next()` 委派。若没有应答者认领，分发的默认行为是继续，因此无人值守的运行永远不会挂起。

请求只携带可安全传输的字段：`agent` 引用在传输中会被替换为对应的 Client Context，`signal` 在传输时被剥离，而 `breakpoint`、`turn`、`step` 以及可选的 `call` 身份按无损 JSON 传输。应答是一个 `action`。

## 暂停点

`context` 在 `agent/pre-step` waterfall 中运行，位于该步领取输入并完成请求组装之后、`step/start` 之前。首个被提议且不带消息的步骤会在不发起模型调用的情况下结束该轮，因此不会被拦下；后续的空步骤仍会基于日志中的工具结果发起请求，因此会被拦下。

`tool` 在 `tools/pre-execute` waterfall 中运行，位于派发之前、该调用的审批询问之前，因此被拦下的调用会先于任何权限请求做出决定。`run_code` 子调用走同一阶段。

## 语义

武装按每次运行一次性生效。`/step` 命令武装被寻址 Agent 的下一次运行；出现以下情况时武装被释放：继续运行的决策、被武装的运行进入 `idle`，或 `/step off`。

暂停一律放行：没有应答者、分发被拒绝（例如浏览器断开）、监听器抛错，以及轮次被取消，都会继续。人类交互只对运行时根 Agent 开放，因此被其他 Agent 拥有的 Agent 永远不会被拦下。

两个暂停点都是已有文档的循环与工具扩展点，因此 agent loop 与工具注册表都不需要改动。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="step-mode-events"></a>

### `step-mode/*` events

<a id="step-modeadvance--waterfall"></a>

#### `step-mode/advance` — waterfall

Ask composed answerers how to advance one paused agent. Return a decision to claim the pause or call `next()` to delegate. With no claiming answerer the dispatch default resumes, so an unattended run never hangs. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.

```ts cordis-catalog
/**
 * Ask composed answerers how to advance one paused agent. Return a decision
 * to claim the pause or call `next()` to delegate. With no claiming
 * answerer the dispatch default resumes, so an unattended run never hangs.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners
 * receive only that agent.
 * @param request - the held unit and its cancellation lifetime.
 * @param next - delegates to the remaining answerers.
 * @mode waterfall
 */
'step-mode/advance'( this: Scoped<Agent>, request: StepAdvanceRequestEvent, next: () => Promise<StepAdvanceDecision>, ): Promise<StepAdvanceDecision>
```

Types: [Agent](core.zh.md) · [Scoped](scope.zh.md)

Source: [`packages/interaction/step-mode/src/types.ts`](../../packages/interaction/step-mode/src/types.ts)
<!-- END GENERATED cordis-surface -->

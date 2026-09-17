# Step Execution Mode

English | [中文](step-mode.zh.md)

[`@deepseek-ai/dsh-step-mode`](../../packages/interaction/step-mode) holds an armed Agent at each configured pause point until a human-facing answerer decides how to advance. The browser half is [`@deepseek-ai/dsh-client-ui-step-mode`](../../packages/client/ui-step-mode).

Source: [`packages/interaction/step-mode/src/types.ts`](../../packages/interaction/step-mode/src/types.ts)

## Public types

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

## Event: `step-mode/advance`

Agent-scoped waterfall. Each pause dispatches the held unit; an answerer returns a decision to claim the pause or calls `next()` to delegate. With no claiming answerer the dispatch default resumes, so an unattended run never hangs.

The request carries only transport-safe fields: the projected `agent` reference is replaced by the corresponding Client Context in transit and `signal` is stripped for transport, while `breakpoint`, `turn`, `step`, and the optional `call` identity travel as lossless JSON. The answer is one `action`.

## Pause points

`context` runs in the `agent/pre-step` waterfall, after the step claimed its input and assembled the request and before `step/start`. A first proposed step carrying no messages closes its turn without a model call and is not held; a later empty step still issues a request over the log's tool results and is held.

`tool` runs in the `tools/pre-execute` waterfall, before dispatch and before the approval ask for that call, so a held call is decided before any permission request appears. `run_code` sub-calls route through the same stage.

## Semantics

Arming is one-shot per run. The `/step` command arms the addressed Agent's next run; the arm is released by the resuming decision, by the armed run reaching `idle`, or by `/step off`.

A pause fails open: no answerer, a rejected dispatch such as a disconnected browser, a throwing listener, and an aborted turn all resume. Human interaction is admitted only for a runtime root, so an Agent owned by another Agent is never held.

Both pause points are documented loop and tool extension points, so the agent loop and the tool registry are unchanged.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.md) · [Scoped](scope.md)

Source: [`packages/interaction/step-mode/src/types.ts`](../../packages/interaction/step-mode/src/types.ts)
<!-- END GENERATED cordis-surface -->

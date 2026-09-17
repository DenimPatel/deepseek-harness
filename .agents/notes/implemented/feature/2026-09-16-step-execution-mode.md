# Agent Note: Step execution mode over two documented pause points

Status: implemented

English | [中文](2026-09-16-step-execution-mode.zh.md)

## Problem

A fast model makes the agent loop hard to follow. The Web Observability panel already renders every turn, step, request, and tool call live in its Flow view, but by the time a reader finds the row that explains what the loop just did, several more steps have run. Following the loop needs a way to stop it at a chosen point, inspect the state, and continue one unit at a time — the interaction a debugger provides, not a slower model or a richer log.

The loop has no pause. `AgentStatus` is only `idle | running`, the only stop is `agent.cancel()`, and cancellation aborts the turn rather than holding it. Adding a suspend/resume state machine to the loop would have to answer every question the existing cancellation, inbox-claim, and driver-convergence rules already answer.

## Decision

Step mode pauses on two extension points the loop and the tool registry already document, so neither package changes. `agent/pre-step` runs after the step claimed its inbox input and assembled the request and before `step/start`, which is "context ready, no request sent yet". `tools/pre-execute` runs before dispatch and before the approval ask for that call, so a held call is decided before any permission prompt appears; `run_code` sub-calls route through the same stage. `@deepseek-ai/dsh-step-mode` (`packages/interaction/step-mode`) registers one listener on each and holds the step by awaiting a waterfall answer.

The answer travels the human-interaction path the product already uses. `step-mode/advance` is an Agent-scoped forwarded waterfall (`packages/api/remotes/src/remote-events.ts`), answered in the browser by `ctx.remote.$on`, published as a Session pending interaction, and rendered by `@deepseek-ai/dsh-client-ui-step-mode` (`packages/client/ui-step-mode`). An answer is `{ action: 'step' }` to run exactly this unit or `{ action: 'resume' }` to run the rest of the run.

Arming is one-shot per run and lives on the Host, so an unarmed run pays no round trip. The composer's `Alt+Enter` gesture and the composer tool row's Step button both run the `/step` command through the Session's existing command verb and then submit; `ui-conversation` reads the arming capability through `ctx.get('stepMode')` and owns the gesture, so neither package imports the other's values. `Shift+Enter` advances while the takeover replaces the composer, and keeps its line-break meaning while a draft is being typed.

The two failure directions are deliberately opposite. A pause **fails open**: no answerer, a rejected dispatch such as a disconnected browser, a throwing listener, and an aborted turn all resume, so an unattended run can never hang, and only a runtime root is ever held. Arming **fails closed**: a refused arm shows the failure and sends nothing, so `Alt+Enter` cannot silently start an ordinary run.

## Consequences

`agent/pre-step` runs after `inbox.claim()`, so a cancel during a pause at the first step ends the turn without re-emitting the claimed message — the same outcome as cancelling any turn after its claim, and documented as a limitation rather than hidden. A reload loses the pending pause because the Host does not re-announce one to a new browser generation. Neither is a loop change; both are what the chosen extension points cost.

## Alternatives considered

**A suspend/resume phase in the agent loop.** Rejected: it would duplicate the driver's existing convergence, cancellation, and inbox rules for one debugger feature, and `docs/architecture.md` already answers "intercept a request, tool, or turn" with the `agent/*` and `tools/*` events.

**Asking the browser at every step and letting it decide whether to pause.** Rejected: it puts a network round trip in front of every model request and tool call of every run, including runs where step mode is off.

**Pausing before the claim, so a cancelled pause loses nothing.** Rejected for now because no documented extension point runs before `inbox.claim()`; providing one is a loop change whose only current consumer would be this feature.

**Persisting the arm in settings.** Rejected: a sticky mode would silently step later runs the user did not arm. The arm belongs to one run and is released by the resuming decision, by the run reaching `idle`, or by `/step off`.

**Widening `SessionPromptRequest` with a `step` flag.** Rejected: it would make the generic Session transport aware of a debugger feature. The command registry already carries a user gesture to a Host plugin without a new wire type.

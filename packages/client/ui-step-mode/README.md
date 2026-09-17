---
description: "Web step-mode: the pause takeover over the composer, the composer Step button, and the Observability panel's pause controls."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-step-mode

English | [中文](README.zh.md)

## Summary

Browser half of step execution mode. It makes the first user gesture that arms a stepped run and presents the pause the Host holds, in three places that share one pending value:

- the composer takeover, which replaces the resident composer while a pause holds the Agent;
- the composer tool row's Step button, which arms the next run and then submits the draft;
- the Observability panel's control strip, so a run can be advanced while the Flow ledger is on screen.

## Table of Contents

- [Gestures](#gestures)
- [Registration surfaces](#registration-surfaces)
- [Wiring with the Host](#wiring-with-the-host)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="gestures"></a>
## Gestures

- **`Alt+Enter` in the composer** arms the addressed Session's next run and then submits the draft. `ui-conversation` owns the gesture and delegates to this package's `ctx.stepMode` service through `ctx.get`, so neither package imports the other's values.
- **`Shift+Enter`** advances one unit while a pause holds the composer. It keeps its line-break meaning while a draft is being typed, because the takeover replaces the composer and holds no editor.
- **Step / Resume / Stop** appear on both the takeover and the panel strip. Stop cancels the run through the Session's own cancellation.

Arming fails closed: when the Host has no `/step` command the composer shows the failure and sends nothing, rather than starting an ordinary run. Pausing fails open, which the Host package owns.

<a id="registration-surfaces"></a>
## Registration surfaces

| Seat | Entry | What it renders |
|---|---|---|
| `conversation.composer` | chain selector on `PendingStepPause` | the pause takeover |
| `conversation.input.right` | `step-run` | the Step button |
| `sidebar.right.pane.tab.controls` | single | the Observability control strip |

The panel seat is declared by `ui-observability`; this package fills it. All three read the same published pending interaction, so one pause is answered identically wherever the user reaches it.

<a id="wiring-with-the-host"></a>
## Wiring with the Host

The plugin subscribes to the forwarded `step-mode/advance` waterfall, publishes each request as a Session pending interaction, and returns the chosen decision; delegation calls `next()` for the remaining answerers. `ctx.stepMode.armNextRun(sessionId)` runs the Host `/step` command through the Session's existing command verb and reports whether the Host accepted it.

## Model Experience

None, as the browser half sends one `/step` command per armed run and resolves a Host waterfall without adding prompt content or tokens.

#### KV Cache effect

None. The browser half never reaches a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A reload loses the pause.** The pending value is process-local to the browser generation that received it, and the Host does not re-announce a pause to a new generation.
- **A refused arm keeps the draft.** The composer shows the refusal instead of sending an ordinary run; the draft stays in the machine for a later submission.
- **Step mode is not persisted.** The arm belongs to one run and is never written to settings, so a later run cannot inherit it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The `'step'` composer gesture and the `stepRun` composer-bar capability live in `ui-conversation`; this package supplies the capability, the paused presentations, and the `ctx.stepMode` service.

</details>

**Runtime invariant:** No companion is published. The plugin's only owned relation is one pending interaction per Session, which `uiSession.registerPendingInteraction` already governs and releases.

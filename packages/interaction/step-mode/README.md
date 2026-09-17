---
description: "Step execution mode: holds each model request and each tool dispatch of an armed run until a human-facing answerer decides how to advance."
kind: "package-reference"
---

# @deepseek-ai/dsh-step-mode

English | [中文](README.zh.md)

## Summary

Host half of step execution mode. An armed Agent pauses at each configured pause point and waits for an answerer on the `step-mode/advance` waterfall; the shipped answerer is the Web step-mode panel. Pause points are the documented `agent/pre-step` and `tools/pre-execute` waterfalls, so the agent loop and the tool registry are unchanged.

## Table of Contents

- [Config](#config)
- [Commands](#commands)
- [Pause points](#pause-points)
- [Failure behavior](#failure-behavior)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="config"></a>
## Config

| Field | Default | Meaning |
|---|---|---|
| `breakpoints` | `['context', 'tool']` | Pause points to hold at. An empty list disables stepping without unloading the plugin; `/step` still arms and reports. |

<a id="commands"></a>
## Commands

`/step` arms the addressed Agent's next run; `/step off` releases an arm that has not run yet.

Arming is one-shot per run. An arm is released when the answerer chooses the resuming decision, when the armed run reaches `idle`, or by `/step off`.

<a id="pause-points"></a>
## Pause points

- `context` — after the step claimed its input and assembled the request, before `step/start`. A first proposed step carrying no messages closes its turn without a model call, so it is not held; later empty steps still issue a request over the log's tool results and are held.
- `tool` — in `tools/pre-execute`, before dispatch and before the approval ask for that call, so a held call is decided before any permission request appears. `run_code` sub-calls route through the same stage and are held too.

Each pause dispatches `step-mode/advance` with the breakpoint, the turn and step, and the held call's name and id for the `tool` breakpoint. An answerer returns `{ action: 'step' }` to run exactly this unit and pause again, or `{ action: 'resume' }` to run the rest of the run without pausing.

<a id="failure-behavior"></a>
## Failure behavior

A pause fails open. With no answerer the dispatch default resumes; a rejected dispatch (a browser that disconnected), a throwing listener, and an aborted turn all resume, so an unattended run can never hang. The turn's own cancellation still decides the outcome: the listener returns the step decision and the loop's `throwIfAborted` cancels. Human interaction is valid only for a runtime root, so an Agent owned by another Agent is never held.

Agent Note:

- [.agents/notes/implemented/feature/2026-09-16-step-execution-mode.md](../../../.agents/notes/implemented/feature/2026-09-16-step-execution-mode.md)

<a id="model-experience"></a>
## Model Experience

None, as a pause holds a request at a documented boundary without adding prompt content, a tool schema, or tokens.

#### KV Cache effect

None. Holding a step changes when a request is sent, never what it contains.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A cancel during a pause does not restore the claimed input.** `agent/pre-step` runs after `inbox.claim()`, so the pause happens after the step's messages left the durable inbox; cancelling there ends the turn without re-emitting them, as it does for any turn cancelled after its claim.
- **A reload does not re-announce the pause.** The pending value lives in the browser half for the socket generation that received it; a reloaded page shows no pause, and the run continues only because the disconnect releases it.
- **Only the shipped Web answerer releases a pause interactively.** Headless and ACP runs arm without pausing, because nothing answers the waterfall.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The plugin is a function plugin with no service surface: the only consumer of its state is its own `/step` command and its own two listeners. `packages/client/ui-step-mode` provides the interactive answerer.

</details>

**Runtime invariant:** No companion is published. The pause is a request/response on one waterfall and publishes no independent observation; holding a step leaves no durable trace beyond the step boundaries the loop already records.

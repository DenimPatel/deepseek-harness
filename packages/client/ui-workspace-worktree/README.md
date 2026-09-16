---
description: "Web parallel-edits surface: the project-row New-worktree entry, each worktree row's status and actions, and the Session header's merge/discard control."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace-worktree

English | [中文](README.zh.md)

## Summary

This package renders the Web GUI's parallel-edits surface: a New-session-in-worktree entry beside each project's New-session button, one nested row per worktree checkout showing its branch and how far it has moved, a Session-header control offering Merge and Discard, and the create dialog. It reads Workspace rows through the framework's Workspace hook and reaches the Host only through the injected `ctx.gitWorktrees` facade, so no git command runs in the browser. Load it against a Host that serves the `gitWorktree` Remote namespace; without that service the plugin stays pending and contributes nothing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The New-session-in-worktree entry sits beside the project's New-session button. Its first activation observes the project directory: a directory that is not a repository, is itself a linked worktree, or a Host without git reports the reason inline instead of opening the dialog, and the trigger then stays disabled. The dialog takes a worktree name, shows the name it will become a branch from, states the base revision the Host will cut from, and offers the configured setup command as a checkbox only when the deployment configured one. Creating a checkout opens its Session through the workspace navigation service, so the new Session lands in the sidebar under its project.

Each worktree row shows its branch and one state chip: missing, one changed file, several changed files, commits ahead, commits behind, or clean. A pointer over the chip refreshes it, and the row menu offers Merge, Discard, and a Forget action whose only job is to drop a registration whose directory is gone. Discard asks for confirmation naming the files and commits at stake, then removes the checkout and the registration while leaving the Session transcript readable. The Session-header control repeats Merge and Discard where the user is already reading, and disables both with a reason while the Session is running or the checkout is missing.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package contributes to three slots: `sidebar.workspaces.projectActions` for the create entry, `sidebar.workspaces.worktreeRow` for one worktree row's status and actions, and `conversation.session.header.actions` for the Session control. Every component receives the four props shares and reaches the Host only through the `gitWorktrees` injection; no component subscribes to anything itself, and no component sees `ctx`. Nesting is not this package's concern: `packages/client/ui-workspace` derives worktree groups from the Workspace descriptor and renders this package's row into each of them.

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as this package renders and operates host worktree state for a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Status is sampled, not subscribed** — a checkout changed by another process shows counts from the last refresh until the row chip or the header is pointed at again, and there is no polling.
- **The dialog previews the name, not the final branch** — the displayed branch line echoes the typed name, while the Host applies its configured prefix and slug; the row shows the branch actually created.
- **Reveal in file manager is absent** — this plugin may not runtime-import another feature plugin's values, and the host open-in-app seam exports no Cordis service, so the row shows the checkout path instead.
- **No bulk actions** — Merge and Discard act on one worktree Workspace at a time, through its row or its Session header.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Every fact this package renders comes from the Workspace stream and the `gitWorktrees` facade, so it owns no independently observable relation to check.

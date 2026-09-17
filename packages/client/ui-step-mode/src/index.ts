/**
 * Web step-mode plugin, node half.
 *
 * Host-side pause points and the `/step` command belong to
 * `@deepseek-ai/dsh-step-mode`; this package owns only how a browser presents a
 * pending pause and where a person arms the next run. A profile that composes
 * the browser half without the host plugin still renders, and the arm attempt
 * reports the missing command instead of starting an ordinary run.
 */

/** Host plugin body — nothing to install on the Host face. */
export function apply(): void {}

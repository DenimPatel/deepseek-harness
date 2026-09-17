/**
 * Client-namespace projection of the step-mode domain: a pure re-export of the
 * package's client-safe types outlet, so browser code imports only the client
 * namespace while Host consumers read the same single source.
 *
 * @module @deepseek-ai/dsh-step-mode/client
 */

export type * from './types.ts'

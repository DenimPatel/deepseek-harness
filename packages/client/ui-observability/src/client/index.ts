/**
 * Browser half: registers the observability dashboard as a sidebar-right page
 * type with a guide entry, and mounts its body through the
 * `sidebar.right.pane.tab` slot. All figures come from existing projections and
 * the session list; this plugin adds no host capability, event, or projection.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer-owned slots service.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session standard useProjection seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the right-Sidebar tab registry and its definition type.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { ObservabilityPanel } from './ObservabilityPanel.tsx'
import { en, NS, zh } from './locales.ts'

export { NS } from './locales.ts'

/** Unique implementation identity; also the slot key its body registers under. */
export const OBSERVABILITY_TAB_ID = '@deepseek-ai/dsh-client-ui-observability'

/** Required services for the dashboard's registration surfaces and copy. */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

function definition(t: TranslateNS<typeof NS>): SidebarRightTabDefinition {
  return {
    id: OBSERVABILITY_TAB_ID,
    kind: 'observability',
    priority: 'builtin',
    title: () => t('title'),
    guide: [{
      id: 'observability',
      order: 30,
      title: () => t('title'),
      description: () => t('guide.description'),
    }],
  }
}

/**
 * Register the dashboard's dictionaries, tab type, and tab body.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-observability: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.sidebarRightTabs.register(definition(t)), 'ui-observability: tab type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: OBSERVABILITY_TAB_ID, locale: NS },
    ObservabilityPanel,
  )), 'ui-observability: tab body')
}

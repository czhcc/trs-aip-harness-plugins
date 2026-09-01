/** Browser plugin registering the independent MCP Clients Settings section. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { MCP_SETTINGS_NAMESPACE, type McpSettings } from '../model.js'
import { McpSettingsSection } from './McpSettingsSection.js'

export const inject = ['slots', 'settingsScope']

export function apply(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<McpSettings>({ namespace: MCP_SETTINGS_NAMESPACE })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'trs-aip-mcp',
    order: 30,
    label: 'MCP 客户端',
    inject: () => ({ scope }),
  }, McpSettingsSection))
}

export { McpSettingsSection } from './McpSettingsSection.js'

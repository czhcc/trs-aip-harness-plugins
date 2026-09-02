/** Browser plugin registering the independent MCP Clients Settings section. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { CredentialInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { MCP_SETTINGS_NAMESPACE, type McpSettings } from '../model.js'
import { MCP_STATUS_REMOTE } from '../status-remote.js'
import type { McpRuntimeSnapshot } from '../status.js'
import { McpSettingsSection, type McpSettingsOperations } from './McpSettingsSection.js'

// Mounting the contribution creates `remote.trsAipMcp`; UI code must run in a
// child fiber that explicitly injects that dynamically-created namespace.
export const inject = ['remote']

function registerMcpSettingsUi(ctx: ClientContext): void {
  const scope = ctx.settingsScope.bind<McpSettings>({ namespace: MCP_SETTINGS_NAMESPACE })
  const operations: McpSettingsOperations = {
    loadStatus: async (): Promise<McpRuntimeSnapshot | undefined> => {
      const response = await ctx.remote.trsAipMcp.snapshot()
      if (!response.ok) throw new Error(response.error.message)
      return response.value
    },
    describeCredentials: async (refs): Promise<Record<string, CredentialInfo>> => {
      if (refs.length === 0) return {}
      const described: Record<string, CredentialInfo> = {}
      for (let offset = 0; offset < refs.length; offset += 64) {
        const response = await ctx.remote.credentials.describe(refs.slice(offset, offset + 64))
        if (!response.ok) throw new Error(response.error.message)
        Object.assign(described, response.value)
      }
      return described
    },
    setCredential: async (ref, value): Promise<string | undefined> => {
      const response = await ctx.remote.credentials.set(ref, value)
      return response.ok ? undefined : response.error.message
    },
    unsetCredential: async (ref): Promise<string | undefined> => {
      const response = await ctx.remote.credentials.unset(ref)
      return response.ok ? undefined : response.error.message
    },
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'trs-aip-mcp',
    order: 30,
    label: 'MCP 客户端',
    inject: () => ({ scope, operations }),
  }, McpSettingsSection))
}

export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(MCP_STATUS_REMOTE)
  const ui = ctx.inject([
    'slots',
    'settingsScope',
    'remote.credentials',
    'remote.trsAipMcp',
  ], registerMcpSettingsUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}

export { McpSettingsSection } from './McpSettingsSection.js'

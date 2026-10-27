import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { RAG_REMOTE } from '../remote.js'
import type { RagSettings } from '../settings.js'
const SETTINGS_NAMESPACE = 'trs-aip-knowledge-rag'
import { Panel, SessionSwitch } from './Panel.js'
import { Settings } from './Settings.js'
import { styles } from './styles.js'
import type { RagApi } from './api.js'
const ID = '@trs-aip/dsh-knowledge-rag'
export const inject = ['remote']
export async function apply(ctx: Context) {
  const unmount = await ctx.remote.$mount(RAG_REMOTE)
  const fiber = ctx.inject(['slots', 'sidebarRight', 'sidebarRightTabs', 'configForms', 'remote.trsAipRag', 'remote.credentials', 'remote.session'], child => {
    const apis = new Map<string, RagApi>()
    const api = (sessionId: string): RagApi => {
      let value = apis.get(sessionId)
      if (!value) { value = { async call<T>(action: string, input?: unknown, signal?: AbortSignal): Promise<T> {
        const result = await child.remote.trsAipRag.request({ sessionId, action, ...(input === undefined ? {} : { input }) }, signal)
        if (!result.ok) throw new Error(result.error.message)
        return result.value as T
      } }; apis.set(sessionId, value) }
      return value
    }
    child.effect(() => { const el = document.createElement('style'); el.dataset.plugin = ID; el.textContent = styles; document.head.append(el); return () => { el.remove(); apis.clear() } })
    child.effect(() => child.sidebarRightTabs.register({ id: ID, kind: 'knowledge-rag', multiple: false, priority: 'extension', keepMounted: true, title: () => '知识库', guide: [{ id: 'open', order: 25, title: () => '知识库', description: () => '文档、图谱、检索和问答' }] }))
    child.slots.inject('sidebar.right.pane.tab', () => child.slots.register({ name: 'sidebar.right.pane.tab', key: ID,
      inject: sessionId => ({ api: api(sessionId), expand: (element: HTMLElement) => { const target = child.sidebarRight.commandTarget(element); if (target) child.sidebarRight.toggleFullscreen(target) } }),
    }, Panel))
    child.slots.inject('conversation.session.header.actions', () => child.slots.register({ name: 'conversation.session.header.actions', id: ID, order: 30, inject: sessionId => ({ api: api(sessionId) }) }, SessionSwitch))
    child.slots.inject('conversation.hero.options', () => child.slots.register({ name: 'conversation.hero.options', id: ID, order: 30, inject: sessionId => ({ api: api(sessionId) }) }, SessionSwitch))
    const scope = child.configForms.get<RagSettings>(SETTINGS_NAMESPACE)
    const loadModels = async () => { const r = await child.remote.session.modelCatalog(); if (!r.ok) throw new Error(r.error.message); return r.value }
    child.slots.inject('settings.section', () => child.slots.register({ name: 'settings.section', id: 'trs-aip-knowledge-rag', label: '知识库', order: 40, inject: () => ({ scope,
      loadModels,
      setCredential: async (ref: string, value: string) => { const r = await child.remote.credentials.set(ref, value); if (!r.ok) throw new Error(r.error.message) },
      unsetCredential: async (ref: string) => { const r = await child.remote.credentials.unset(ref); if (!r.ok) throw new Error(r.error.message) },
    }) }, Settings))
  })
  try { await fiber } catch (e) { await fiber.dispose(); await unmount(); throw e }
  return async () => { await fiber.dispose(); await unmount() }
}

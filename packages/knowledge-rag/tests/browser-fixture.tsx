import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import { createRoot } from 'react-dom/client'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives/src/Modal.tsx'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives/src/Button.tsx'
import { CHINA_POLICE_STYLES } from '../../skin-china-police/src/client/styles.ts'

const records = new Map<string, any>(), disposers: (() => unknown)[] = []
const fixture = await fetch('/fixture.json').then(r => r.json())
let plugin: any, revision = 0
const sessionModes = new Map<string, boolean>()
const settings = { text: { provider: '', model: '' }, embedding: { endpoint: '', model: '', credentialRef: '', dimensions: 1024, batchSize: 32, timeoutMs: 60000, operatorRevision: 0 }, rerank: { enabled: false, endpoint: '', model: '', credentialRef: '', topN: 10, timeoutMs: 60000, failurePolicy: 'fallback-with-warning' } }
let failCatalog = false
const modelCatalog = async () => failCatalog ? { ok: false, error: { message: '测试服务商不可达' } } : { ok: true, value: { default: { provider: 'fake', model: 'text' }, routableProviders: ['fake', 'other'], groups: [{ id: 'fake', name: 'DSH 服务商 A', models: [{ id: 'text', name: '文本 A' }] }, { id: 'other', name: 'DSH 服务商 B', models: [{ id: 'text-b', name: '文本 B' }] }], failures: [] } }
const scope = {
  snapshot: { status: 'ready', value: settings, writable: true, revision, base: {}, user: {} },
  listeners: new Set<() => void>(),
  getSnapshot() { return this.snapshot },
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn) },
  async mutate(ops: any[], expected: number) {
    if (expected !== revision) return false
    for (const op of ops) (settings as any)[op.path[0]] = op.value
    this.snapshot = { ...this.snapshot, value: structuredClone(settings), revision: ++revision }
    for (const fn of this.listeners) fn()
    return true
  },
}
const requests: string[] = []
let emptyGraph = false
const request = async (input: any) => {
  if (Object.values(input).some(value => value === undefined)) throw new Error('Undefined RPC field')
  const { action } = input
  requests.push(action)
  const value = action === 'session.get' ? { enabled: sessionModes.get(input.sessionId) ?? false }
    : action === 'documents.list' ? fixture.documents
    : action === 'documents.detail' ? fixture.detail
    : action === 'documents.parsed' ? fixture.parsed
    : action === 'status' ? fixture.status
    : action === 'graph.catalog' ? emptyGraph ? { ...fixture.catalog, items: [], total: 0 } : fixture.catalog
    : action === 'graph.browse' || action === 'graph.select' ? emptyGraph ? { ...fixture.graph, nodes: [], edges: [], totalNodes: 0, totalEdges: 0, matchedNodes: 0, truncated: false } : fixture.graph
    : action === 'graph.sources' ? fixture.sources
    : action === 'query.preview' ? fixture.preview
    : action === 'query.answer' ? { id: 'answer-op' }
    : action === 'operation.poll' ? { cursor: 2, done: true, events: [{ type: 'delta', text: '**Alpha** [1]\n\n<script>window.unsafe=true</script>\n![remote](https://example.invalid/pixel.png)' }, { type: 'done', finishReason: 'stop', warnings: [], data: fixture.preview }] }
    : action === 'chat.list' ? [] : {}
  return { ok: true, value }
}
const child: any = {
  remote: { $mount: async () => () => {}, session: { modelCatalog }, trsAipRag: { request: async (r: any) => r.action === 'session.set' ? (sessionModes.set(r.sessionId, r.input.enabled), { ok: true, value: { enabled: r.input.enabled } }) : request(r) }, credentials: { set: async () => ({ ok: true }), unset: async () => ({ ok: true }) } },
  effect(fn: () => any) { const off = fn(); if (typeof off === 'function') disposers.push(off) },
  sidebarRightTabs: { register: (tab: any) => { (window as any).tab = tab; return () => {} } },
  sidebarRight: { commandTarget: () => 'pane', toggleFullscreen: () => document.body.classList.toggle('expanded') },
  configForms: { get: () => scope },
  slots: { inject: (_: string, fn: () => unknown) => fn(), register: (spec: any, component: any) => { records.set(spec.name, { spec, component }); return () => records.delete(spec.name) } },
  inject(_: string[], fn: (ctx: any) => unknown) {
    const done = Promise.resolve(fn(child)) as any
    done.dispose = async () => { const off = await done; await off?.(); for (const d of disposers.splice(0).reverse()) await d() }
    return done
  },
}
const modules: Record<string, any> = { react: React, 'react/jsx-runtime': jsx, '@deepseek-ai/dsh-client-ui-primitives': { Button, Modal } }
;(window as any).__ModuleLoader__ = { load({ factory }: any) { plugin = factory((id: string) => { if (!(id in modules)) throw new Error(`Unsupported browser import: ${id}`); return modules[id] }) } }
await new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = '/client.js'; script.onload = () => resolve(); script.onerror = reject; document.head.append(script) })
const dispose = await plugin.apply(child)
const police = document.createElement('style'); police.textContent = CHINA_POLICE_STYLES; document.head.append(police)
const root = createRoot(document.getElementById('root')!)
function render(slot = 'sidebar.right.pane.tab', sessionId = 'session-a') {
  const { component: Component, spec } = records.get(slot)
  root.render(<Component key={`${slot}:${sessionId}`} {...spec.inject(sessionId)}/>)
}
render()
Object.assign(window, { showSessionSwitch: (hero: boolean, sessionId = 'session-a') => render(hero ? 'conversation.hero.options' : 'conversation.session.header.actions', sessionId) })
Object.assign(window, { requests, emptyGraph: (value: boolean) => { emptyGraph = value }, settingsSnapshot: () => scope.snapshot, failCatalog: (value: boolean) => { failCatalog = value }, showSettings: () => render('settings.section'), showPanel: () => render(), dispose: async () => { root.unmount(); await dispose() } })

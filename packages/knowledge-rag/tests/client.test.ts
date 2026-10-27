import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { Context } from '@deepseek-ai/cordis'

const fromRemotes = createRequire(import.meta.resolve('@deepseek-ai/dsh-api-remotes'))
const gatewayEntry = fromRemotes.resolve('@deepseek-ai/dsh-api-gateway/client')
const Gateway = await import(pathToFileURL(gatewayEntry).href)
const fromGateway = createRequire(gatewayEntry)
const Registry = await import(pathToFileURL(fromGateway.resolve('@deepseek-ai/dsh-typert-registry/client')).href)
const require = createRequire(import.meta.url)

test('built Client activates through the real Client Gateway and validates request inputs', async () => {
  const ctx = new Context()
  const calls: unknown[] = [], registrations: string[] = []
  const style = { dataset: {}, textContent: '', remove() {} }
  let client: any
  const entry = process.env.RAG_TEST_ENTRY ?? new URL('../lib/index.js', import.meta.url).href
  runInNewContext(await readFile(new URL('./client.js', entry), 'utf8'), {
    window: { __ModuleLoader__: { load: ({ factory }: any) => { client = factory((id: string) => id === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(id)) } } },
    document: { createElement: () => style, head: { append() {} } },
    AbortController, AbortSignal, TextEncoder, TextDecoder, URL, setTimeout, clearTimeout, console,
  })
  try {
    await ctx.plugin(Registry)
    ctx.provide('connection', {
      interactions: 'none', isLoopback: true,
      generation: { getSnapshot: () => undefined, subscribe: () => () => {} },
      rpc: { call: async (...args: unknown[]) => { calls.push(args); return { ok: true, value: { enabled: false } } }, open: async function* () {} },
      start: () => ({ stop() {} }), openWebSocket: () => { throw new Error('unexpected socket') },
    } as never)
    await ctx.plugin(Gateway)
    ctx.provide('remote.credentials', {} as never)
    ctx.provide('remote.session', {} as never)
    ctx.provide('slots', { inject: (_name: string, fn: () => unknown) => fn(), register: (spec: any) => { registrations.push(spec.name); return () => {} } } as never)
    ctx.provide('sidebarRight', {} as never)
    ctx.provide('sidebarRightTabs', { register: () => () => {} } as never)
    ctx.provide('configForms', { get: () => ({}) } as never)
    await ctx.plugin(client)
    assert.ok(registrations.includes('sidebar.right.pane.tab'))
    assert.ok(registrations.includes('conversation.session.header.actions'))
    assert.ok(registrations.includes('conversation.hero.options'))
    assert.ok(registrations.includes('settings.section'))
    const remote = ctx.get('remote.trsAipRag') as any
    assert.ok(remote)
    await remote.request({ sessionId: 'session-a', action: 'session.get' })
    assert.equal(calls.length, 1)
    const { RAG_REMOTE } = await import(entry)
    const codec = RAG_REMOTE.descriptors[0]!.parameters[0]!.codec
    assert.equal(codec.mode, 'strict')
    if (codec.mode === 'strict') assert.throws(() => codec.create().parse({ sessionId: '', action: 'session.get' }))
  } finally { await ctx.fiber.dispose() }
  assert.equal(ctx.get('remote.trsAipRag'), undefined)
})

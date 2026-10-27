import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import DefaultModel from '@deepseek-ai/dsh-agent-default-model'
import Tools from '@deepseek-ai/dsh-tools'
import { isRemoteJsonValue } from '@deepseek-ai/dsh-typert-protocol'
import Access from '@deepseek-ai/dsh-api-remote-access'
const plugin = await import(process.env.RAG_TEST_ENTRY ?? new URL('../lib/index.js', import.meta.url).href)

const fromBoot = createRequire(import.meta.resolve('@deepseek-ai/dsh-app-boot'))
const Loader = (await import(pathToFileURL(fromBoot.resolve('@deepseek-ai/cordis-plugin-loader')).href)).default
const fromTools = createRequire(import.meta.resolve('@deepseek-ai/dsh-tools'))
const Prompt = (await import(pathToFileURL(fromTools.resolve('@deepseek-ai/dsh-system-prompt')).href)).default
const fromRemotes = createRequire(import.meta.resolve('@deepseek-ai/dsh-api-remotes'))
const gatewayEntry = fromRemotes.resolve('@deepseek-ai/dsh-api-gateway')
const Gateway = (await import(pathToFileURL(gatewayEntry).href)).default
const fromGateway = createRequire(gatewayEntry)
const Registry = (await import(pathToFileURL(fromGateway.resolve('@deepseek-ai/dsh-typert-registry')).href)).default
const { Peer } = await import(pathToFileURL(fromGateway.resolve('@deepseek-ai/dsh-client-connection')).href)
const graph = { entities: [{ name: 'Alpha', type: 'organization', description: 'Alpha develops graph systems.' }, { name: 'Beta', type: 'organization', description: 'Beta cooperates with Alpha.' }], relationships: [{ source: 'Alpha', target: 'Beta', keywords: 'collaboration', description: 'Alpha and Beta cooperate.', strength: 2 }] }

class FakeAdapter extends LlmAdapter {
  calls = 0
  routes: { provider: string; model: string }[] = []
  slow = false
  reasoningOnly = false
  async resolveModel(provider: string, model: string) { return { provider, id: model, name: model, context: { contextWindow: 32768 }, defaultMaxTokens: 4096 } }
  async *stream(options: any) {
    this.calls++
    this.routes.push({ provider: options.provider, model: options.model })
    if (this.slow) await delay(30000, undefined, { signal: options.signal })
    if (this.reasoningOnly) {
      yield { type: 'reasoning-delta' as const, index: 0, text: 'private reasoning must never become an answer' }
      yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
      return
    }
    const text = JSON.stringify(options.messages)
    const answer = text.includes('keyword extractor') ? JSON.stringify({ high_level_keywords: ['collaboration'], low_level_keywords: ['Alpha'] })
      : text.includes('Knowledge Graph Specialist') ? JSON.stringify(options.messages.some((m: any) => m.role === 'assistant') ? { entities: [], relationships: [] } : graph)
      : 'Alpha and Beta cooperate. [1]'
    yield { type: 'text-delta' as const, index: 0, text: answer }
    yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
  }
}

async function waitFor<T>(read: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) { const value = await read(); if (done(value)) return value; await delay(30) }
  throw new Error('Timed out waiting for durable task')
}

test('Loader: import → index → graph → retrieval → answer, session guards, rebuild, restart and unload', { timeout: 120000 }, async () => {
  await mkdir(resolve('.test-data'), { recursive: true })
  const root = await mkdtemp(resolve('.test-data/integration-'))
  const secret = 'integration-secret-never-persist'
  const requests: { model: string; auth?: string }[] = []
  let failEmbedding = false
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString())
    requests.push({ model: body.model, auth: req.headers.authorization })
    if (failEmbedding) { res.writeHead(400).end('{}'); return }
    res.setHeader('Content-Type', 'application/json')
    if (body.input) res.end(JSON.stringify({ data: body.input.map((s: string, index: number) => ({ index, embedding: [s.length + 1, 1] })) }))
    else res.end(JSON.stringify({ results: body.documents.map((_: string, index: number) => ({ index, relevance_score: 1 / (index + 1) })) }))
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}`
  const adapter = new FakeAdapter()
  let ctx: Context | undefined
  let access = true
  const peers = new WeakMap<Context, { owner: any; guest: any }>()
  const defaults = new WeakMap<Context, any>()
  const initial = { embedding: { endpoint, model: 'embed-v1', dimensions: 2, credentialRef: 'RAG_TEST_KEY' }, rerank: { enabled: true, endpoint: `${endpoint}/rerank`, model: 'rerank', credentialRef: 'RAG_TEST_KEY' } }
  async function start(settings: object = initial, provider = 'fake') {
    const context = new Context()
    context.baseUrl = pathToFileURL(resolve('package.json')).href
    context.provide('profileContext', { dir: root } as never)
    context.provide('settings', { configure: () => () => {} } as never)
    context.provide('credentials', { resolve: async () => ({ value: secret }) } as never)
    await context.plugin(Loader)
    await context.plugin(Registry)
    await context.plugin(Access)
    await context.plugin(Gateway)
    context.typert.register({ package: plugin.RAG_REMOTE.package, face: 'host', schemas: [], model: { services: [], events: [], objects: [] }, invocations: plugin.RAG_REMOTE.descriptors })
    peers.set(context, { owner: new Peer(context, { principal: { kind: 'owner' } }), guest: new Peer(context, { principal: { kind: 'rag-test-guest' } }) })
    await context.plugin(LlmRuntime)
    context.llm.registerAdapter(['fake'], adapter)
    context.loader.builtins.defaultModel = DefaultModel
    const defaultId = await context.loader.create({ id: 'default-model', name: 'cordis:defaultModel', config: { provider, model: 'text' } })
    const defaultEntry = context.loader.resolve(defaultId)
    await defaultEntry.fiber!.await(); defaults.set(context, defaultEntry)
    await context.plugin(Prompt)
    await context.plugin(Tools)
    context.loader.builtins.rag = plugin
    const id = await context.loader.create({ id: 'trs-aip-knowledge-rag', name: 'cordis:rag', config: settings })
    const entry = context.loader.resolve(id)
    await entry.fiber!.await()
    await context.fiber.await()
    try { await waitFor(async () => context.get('trsAipRagController'), value => Boolean(value)) }
    catch (e) { await context.fiber.dispose(); throw e }
    return context
  }
  const signal = new AbortController().signal
  const call = async (action: string, input?: unknown, sessionId = 'session-a'): Promise<any> => {
    const request = { action, ...(input === undefined ? {} : { input }), sessionId }
    assert.ok(isRemoteJsonValue(request))
    const result = await ctx!.typertGateway.invoke({ namespace: 'trsAipRag', method: 'request', args: { request }, signal, peer: access ? peers.get(ctx!)!.owner : peers.get(ctx!)!.guest })
    assert.ok(isRemoteJsonValue(result), `${action} must return SRC-JSON data`)
    return result
  }
  try {
    ctx = await start()
    assert.deepEqual(await call('session.get'), { enabled: false })
    access = false; await assert.rejects(call('documents.list'))
    ctx.remoteAccess.registerPolicy('rag-test-guest' as never, { bindings: () => [{ resource: { kind: 'global' }, role: { name: 'rag-global', resource: 'global', actions: ['trsAipRag/request'] } }] } as never)
    await assert.rejects(call('documents.list'), 'a global grant without session access must still be denied')
    access = true
    const imported = await call('documents.text', { name: 'knowledge.txt', text: 'Alpha develops graph systems. Beta cooperates with Alpha.' })
    const detail = await waitFor(() => call('documents.detail', { id: imported.document.id }), d => ['processed', 'failed', 'awaiting_configuration'].includes(d.job.status))
    assert.equal(detail.job.status, 'processed', JSON.stringify(detail.job))
    assert.ok((await call('documents.parsed', { id: imported.document.id })).text.includes('Alpha'))
    assert.equal((await call('graph.catalog', { kind: 'nodes', offset: 0, limit: 10 })).total, 2)
    const preview = await call('query.preview', { query: 'Alpha', mode: 'mix', enableRerank: true })
    assert.ok(preview.references.length > 0)
    await writeFile('.test-data/ui-fixture.json', JSON.stringify({
      documents: await call('documents.list'), detail, parsed: await call('documents.parsed', { id: imported.document.id }),
      catalog: await call('graph.catalog', { kind: 'nodes', offset: 0, limit: 10 }),
      graph: await call('graph.browse', { q: 'Alpha' }), preview,
      status: await call('status'),
      sources: await call('graph.sources', { id: (await call('graph.catalog', { kind: 'nodes' })).items[0].id, kind: 'node' }),
    }))
    assert.ok(requests.every(r => r.auth === `Bearer ${secret}`))
    const op = await call('query.answer', { query: 'Alpha', mode: 'naive' })
    await assert.rejects(call('operation.poll', { id: op.id }, 'session-b'))
    const result = await waitFor(() => call('operation.poll', { id: op.id }), r => r.done)
    assert.ok(result.events.some((e: any) => e.type === 'done'), JSON.stringify(result))
    adapter.reasoningOnly = true
    const thoughts = await call('query.answer', { query: 'Alpha reasoning', mode: 'naive' })
    const rejected = await waitFor(() => call('operation.poll', { id: thoughts.id }), r => r.done)
    assert.ok(rejected.events.some((e: any) => e.type === 'error'))
    assert.ok(!rejected.events.some((e: any) => e.type === 'delta' || e.type === 'done'))
    adapter.reasoningOnly = false
    const conversation = await call('chat.create')
    const chatOp = await call('chat.send', { id: conversation.id, request: { question: 'Alpha', expectedRevision: conversation.revision, settings: { mode: 'naive' } } })
    await waitFor(() => call('operation.poll', { id: chatOp.id }), r => r.done)
    assert.equal((await call('chat.get', { id: conversation.id })).turns[0].status, 'completed')
    const upload = await call('upload.begin', { name: 'other.txt', bytes: 3 })
    await assert.rejects(call('upload.chunk', { id: upload.id, offset: 0, data: 'YWJj' }, 'session-b'))
    await call('upload.cancel', { id: upload.id })
    const agent = { id: 'session-a' } as any
    const blankAssembly = { sections: [], contexts: [], variables: {}, tools: [] }
    const guidance = (who: any = agent, toolSet?: any) => ctx!.systemPrompt.refreshContext(blankAssembly, { ...(who ? { agent: who, scope: who } : {}), ...(toolSet ? { toolSet } : {}) }).contexts.find(row => row.name === 'trs-aip-knowledge-rag:availability')?.text ?? ''
    assert.equal(guidance(), '', 'disabled sessions must not receive knowledge guidance')
    let set = await ctx.tools.resolve({ agent, modelSelection: { provider: 'fake', model: 'text' }, signal })
    assert.equal(ctx.tools.executable('knowledge_search', agent, set), undefined); set.dispose()
    await call('session.set', { enabled: true })
    set = await ctx.tools.resolve({ agent, modelSelection: { provider: 'fake', model: 'text' }, signal })
    const tool = ctx.tools.executable('knowledge_search', agent, set)!
    assert.ok(tool)
    assert.match(guidance(agent, set), /优先调用 knowledge_search/)
    assert.match(guidance(), /不等同于本地工作区文件/, 'admission refresh without a tool set must retain enabled guidance')
    assert.equal(guidance({ id: 'session-b' }), '', 'guidance must not leak to another session')
    assert.equal(guidance(null), '', 'global prompt inspection must not advertise session tools')
    const restoreRuntime = ctx.systemPrompt.suppressRuntimeContext()
    assert.match(guidance(), /knowledge_search/, 'required availability survives optional context suppression')
    restoreRuntime()
    const evidence = await tool.execute({ query: 'Alpha', mode: 'naive' }, { agent, signal } as any) as { evidence: string }
    assert.match(evidence.evidence, /Alpha/)
    assert.match(evidence.evidence, /knowledge.txt/)
    await call('session.set', { enabled: false })
    assert.equal(guidance(agent, set), '', 'switching off must remove guidance even for a prepared step')
    await assert.rejects(tool.execute({ query: 'Alpha', mode: 'naive' }, { agent, signal } as any))
    set.dispose()
    await call('session.set', { enabled: true })
    const entry = ctx.loader.resolve('trs-aip-knowledge-rag'), fiber = entry.fiber
    assert.throws(() => fiber!.resolveConfig({ ...initial, text: { provider: 'fake', model: '' } }))
    await entry.update({ config: { ...initial, text: { provider: 'fake', model: 'rag-fixed' } } })
    await entry.fiber!.await()
    assert.equal(entry.fiber, fiber, 'volatile text selection must not remount the plugin')
    await defaults.get(ctx).update({ config: { provider: 'fake', model: 'chat-other' } })
    adapter.routes.length = 0
    const fixedAnswer = await call('query.answer', { query: 'Alpha fixed model', mode: 'naive' })
    const fixedResult = await waitFor(() => call('operation.poll', { id: fixedAnswer.id }), r => r.done)
    assert.ok(fixedResult.events.some((e: any) => e.type === 'done'), JSON.stringify(fixedResult))
    assert.deepEqual(adapter.routes, [{ provider: 'fake', model: 'rag-fixed' }])
    assert.equal(ctx.agentDefaultModel.currentSelection().model, 'chat-other', 'RAG model selection must not change the DSH default')
    await entry.update({ config: { ...initial, text: { provider: '', model: '' } } })
    await entry.fiber!.await()
    adapter.routes.length = 0
    const followed = await call('query.answer', { query: 'Alpha follow model', mode: 'naive' })
    await waitFor(() => call('operation.poll', { id: followed.id }), r => r.done)
    assert.deepEqual(adapter.routes, [{ provider: 'fake', model: 'chat-other' }])
    await entry.update({ config: { ...initial, text: { provider: 'unconfigured', model: 'missing' } } })
    await entry.fiber!.await()
    adapter.routes.length = 0
    const missing = await call('query.answer', { query: 'Alpha missing model', mode: 'naive' })
    const missingResult = await waitFor(() => call('operation.poll', { id: missing.id }), r => r.done)
    assert.ok(missingResult.events.some((e: any) => e.type === 'error'))
    assert.equal(adapter.routes.length, 0, 'missing fixed model must not fall back to the default')
    await defaults.get(ctx).update({ config: { provider: 'fake', model: 'text' } })
    assert.throws(() => fiber!.resolveConfig({ ...initial, embedding: { ...initial.embedding, dimensions: 0 } }))
    assert.throws(() => fiber!.resolveConfig({ ...initial, embedding: { ...initial.embedding, endpoint: 'https://user:password@example.invalid' } }))
    await entry.update({ config: { ...initial, embedding: { ...initial.embedding, model: 'embed-v2' } } })
    await entry.fiber!.await()
    assert.equal(entry.fiber, fiber, 'volatile vector configuration must not remount the plugin')
    let status = await call('status')
    assert.notEqual(status.models.bindings.embedding, status.models.activeIndex.profile.id)
    requests.length = 0
    await call('query.preview', { query: 'Alpha new', mode: 'naive' })
    assert.equal(requests[0]?.model, 'embed-v1', 'old index must use its captured embedding model')
    failEmbedding = true
    await call('maintenance', { operation: 'rebuild', id: null, request: { expectedCorpusRevision: status.maintenance.corpusRevision, expectedConfigRevision: status.models.revision, targetProfileId: status.models.bindings.embedding } })
    await waitFor(() => call('status'), s => s.maintenance.jobs.some((j: any) => j.status === 'failed'))
    status = await call('status')
    assert.equal(status.models.activeIndex.profile.model, 'embed-v1')
    failEmbedding = false
    const retry = status.maintenance.jobs.find((job: any) => job.status === 'failed')
    await call('jobs.retry', { id: retry.id, request: { expectedCorpusRevision: status.maintenance.corpusRevision, expectedConfigRevision: status.models.revision, targetProfileId: status.models.bindings.embedding } })
    await waitFor(() => call('status'), s => s.models.activeIndex.profile.model === 'embed-v2')
    const metadata = await readFile(join(root, 'data/trs-aip-knowledge-rag/model-metadata/app.json'), 'utf8')
    assert.ok(!metadata.includes(secret))
    await ctx.fiber.dispose(); ctx = await start({ ...initial, text: { provider: 'fake', model: 'rag-fixed' } })
    const restarted = await call('status')
    assert.equal(restarted.models.profiles.find((p: any) => p.id === restarted.models.bindings.query)?.model, 'rag-fixed')
    assert.deepEqual(await call('session.get'), { enabled: true })
    assert.equal((await call('documents.list')).total, 1)
    adapter.slow = true
    const slow = await call('query.answer', { query: 'Alpha cancel', mode: 'naive' })
    await call('operation.cancel', { id: slow.id })
    const cancelled = await waitFor(() => call('operation.poll', { id: slow.id }), r => r.done)
    assert.ok(cancelled.events.some((e: any) => e.type === 'cancelled'))
    await ctx.fiber.dispose(); ctx = undefined
    adapter.slow = false
    ctx = await start({}, 'unconfigured') // Successful reopen proves that unload released the native writer lock.
    const offline = await call('documents.text', { name: 'offline.txt', text: 'Local parsing without model configuration.' })
    const local = await waitFor(() => call('documents.detail', { id: offline.document.id }), d => ['awaiting_configuration', 'failed'].includes(d.job.status))
    assert.equal(local.job.status, 'awaiting_configuration')
    assert.ok((await call('documents.parsed', { id: offline.document.id })).text.includes('Local parsing'))
  } finally {
    await ctx?.fiber.dispose()
    server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()))
    await rm(root, { recursive: true, force: true })
  }
})

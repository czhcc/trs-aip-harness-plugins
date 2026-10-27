import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { SnapshotStore } from './engine/storage/snapshot.js'
import { ModelConfigStore } from './engine/models/config.js'
import { DocumentService } from './engine/documents/service.js'
import { QueryService } from './engine/retrieval/service.js'
import { GenerationService } from './engine/generation/service.js'
import { ConversationService } from './engine/chat/service.js'
import { graphSources } from './engine/graph/browse.js'
import { DshModels } from './models.js'
import { SessionState } from './session-state.js'
import { DocumentListQuerySchema, GraphQuerySchema, GraphSourcesQuerySchema, GraphCatalogQuerySchema, GraphSelectionSchema, QuerySchema, IdSchema, PARSER_CAPABILITIES } from './contracts/index.js'
import type { StreamEvent } from './contracts/index.js'
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './settings.js'
import type { RagRequest } from './remote.js'
import { RagRequestSchema } from './remote.js'

const object = z.record(z.string(), z.unknown())
const idInput = z.object({ id: IdSchema })
const errorMessage = (e: unknown) => e instanceof Error ? e.message : '知识库操作失败'
interface Operation { sessionId: string; controller: AbortController; events: StreamEvent[]; done: boolean; task: Promise<unknown>; created: number }
interface Upload { sessionId: string; name: string; bytes: number; received: number; chunks: Buffer[]; created: number }
export class RagRuntime {
  readonly shutdown = new AbortController()
  readonly queries: QueryService
  readonly generation: GenerationService
  readonly conversations: ConversationService
  private operations = new Map<string, Operation>()
  private uploads = new Map<string, Upload>()
  private searches = new Map<string, Set<AbortController>>()
  private pending = new Set<Promise<unknown>>()
  private offSwitch: () => void
  private constructor(readonly storage: SnapshotStore, readonly models: DshModels, readonly documents: DocumentService, readonly sessions: SessionState) {
    this.queries = new QueryService(storage, models.metadata, models.client)
    this.generation = new GenerationService(this.queries, models.client)
    this.conversations = new ConversationService(storage, this.generation, models.metadata, this.shutdown.signal)
    this.offSwitch = sessions.onChange(id => { if (!sessions.enabled(id)) for (const controller of this.searches.get(id) ?? []) controller.abort() })
  }
  static async open(ctx: Context, config: Config, root: string) {
    const storage = await SnapshotStore.open(root)
    let metadata: ModelConfigStore | undefined, documents: DocumentService | undefined
    try {
      metadata = await ModelConfigStore.open(root, storage)
      const models = new DshModels(ctx, config, metadata)
      await models.sync()
      documents = await DocumentService.open(storage, metadata, { client: models.client })
      const sessions = new SessionState(join(root, 'session-state')); await sessions.open()
      const runtime = new RagRuntime(storage, models, documents, sessions)
      await runtime.conversations.recover()
      return runtime
    } catch (e) { await documents?.close(); await metadata?.close(); await storage.close(); throw e }
  }
  private clean() {
    for (const [id, op] of this.operations) if (op.done && Date.now() - op.created > 120000) this.operations.delete(id)
    for (const [id, upload] of this.uploads) if (Date.now() - upload.created > 120000) this.uploads.delete(id)
  }
  private operation(sessionId: string, run: (signal: AbortSignal, emit: (event: StreamEvent) => Promise<void>, requestId: string) => Promise<unknown>) {
    this.clean()
    if (this.operations.size >= 16 || [...this.operations.values()].filter(o => !o.done).length >= 4) throw new Error('查询通道已满，请稍后重试')
    const id = randomUUID(), controller = new AbortController()
    const op: Operation = { sessionId, controller, events: [], done: false, created: Date.now(), task: Promise.resolve() }
    this.operations.set(id, op)
    const signal = AbortSignal.any([controller.signal, this.shutdown.signal])
    op.task = Promise.resolve().then(() => run(signal, async event => {
      if (op.events.length >= 8192 || Buffer.byteLength(JSON.stringify(op.events)) > 4 * 1024 * 1024) throw new Error('流式结果超过缓存上限')
      op.events.push(event)
    }, id)).catch(e => { op.events.push(signal.aborted ? { type: 'cancelled' } : { type: 'error', error: { code: 'RAG_ERROR', message: errorMessage(e), requestId: id } }) }).finally(() => { op.done = true; op.created = Date.now() })
    return { id }
  }
  async search(sessionId: string, input: unknown, signal: AbortSignal) {
    return this.track(this.searchImpl(sessionId, input, signal))
  }
  private async searchImpl(sessionId: string, input: unknown, signal: AbortSignal) {
    this.shutdown.signal.throwIfAborted()
    if (!this.sessions.enabled(sessionId)) throw new Error('当前对话未启用知识库')
    const controller = new AbortController(), active = this.searches.get(sessionId) ?? new Set<AbortController>()
    this.searches.set(sessionId, active); active.add(controller)
    try {
      await this.models.sync()
      if (!this.sessions.enabled(sessionId)) throw new Error('当前对话已关闭知识库')
      return await this.queries.data(QuerySchema.parse(input), AbortSignal.any([signal, controller.signal, this.shutdown.signal]))
    } finally { active.delete(controller); if (!active.size) this.searches.delete(sessionId) }
  }
  async request(raw: RagRequest, signal: AbortSignal): Promise<unknown> {
    return this.track(this.dispatch(raw, AbortSignal.any([signal, this.shutdown.signal])))
  }
  private async track<T>(task: Promise<T>): Promise<T> {
    this.pending.add(task)
    try { return await task } finally { this.pending.delete(task) }
  }
  private async dispatch(raw: RagRequest, signal: AbortSignal): Promise<unknown> {
    const request = RagRequestSchema.parse(raw)
    const { action, input, sessionId } = request
    signal.throwIfAborted(); this.clean()
    if (this.shutdown.signal.aborted) throw new Error('知识库正在关闭')
    if (action === 'operation.poll' || action === 'operation.cancel') {
      const { id, cursor } = z.object({ id: IdSchema, cursor: z.number().int().min(0).default(0) }).parse(input)
      const op = this.operations.get(id)
      if (!op || op.sessionId !== sessionId) throw new Error('操作不存在或不属于当前会话')
      if (action === 'operation.cancel') { op.controller.abort(); return { cancelled: true } }
      if (cursor > op.events.length) throw new Error('流式游标不合法')
      const events = op.events.slice(cursor, cursor + 128)
      return { events, cursor: cursor + events.length, done: op.done && cursor + events.length === op.events.length }
    }
    if (action === 'session.get') return { enabled: this.sessions.enabled(sessionId) }
    if (action === 'session.set') { const { enabled } = z.object({ enabled: z.boolean() }).parse(input); await this.sessions.set(sessionId, enabled); return { enabled } }
    await this.models.sync()
    const view = this.storage.capture()
    switch (action) {
      case 'status': return { models: this.models.metadata.public(), maintenance: this.documents.maintenanceState(), capabilities: PARSER_CAPABILITIES }
      case 'documents.list': { const q = DocumentListQuerySchema.parse(input ?? {}); return this.documents.list(q.offset, q.limit, q.q, q.status) }
      case 'documents.detail': return this.documents.detail(idInput.parse(input).id)
      case 'documents.parsed': return this.documents.parsed(idInput.parse(input).id)
      case 'documents.text': return this.documents.importText(input)
      case 'documents.retry': { const r = z.object({ id: IdSchema, expectedJobId: IdSchema }).parse(input); return this.documents.retry(r.id, r.expectedJobId) }
      case 'jobs.cancel': return this.documents.cancel(idInput.parse(input).id)
      case 'jobs.retry': { const r = object.parse(input); return this.documents.retryMaintenance(IdSchema.parse(r.id), r.request) }
      case 'maintenance': { const r = z.object({ operation: z.enum(['delete', 'reindex', 'rebuild']), id: IdSchema.nullable(), request: z.unknown() }).parse(input); if (r.operation !== 'rebuild' && r.id === null) throw new Error('必须指定文档'); return this.documents.requestMaintenance(r.operation, r.id, r.request) }
      case 'cleanup': return this.documents.retryCleanup()
      case 'upload.begin': {
        if (this.uploads.size >= 2) throw new Error('上传通道已满')
        const r = z.object({ name: z.string().min(1).max(255), bytes: z.number().int().min(1).max(20 * 1024 * 1024) }).parse(input), id = randomUUID()
        this.uploads.set(id, { ...r, sessionId, received: 0, chunks: [], created: Date.now() }); return { id }
      }
      case 'upload.chunk': {
        const r = z.object({ id: IdSchema, offset: z.number().int().min(0), data: z.string().max(350000).regex(/^[A-Za-z0-9+/]*={0,2}$/) }).parse(input), upload = this.uploads.get(r.id)
        if (!upload || upload.sessionId !== sessionId || upload.received !== r.offset) throw new Error('上传已过期或分块顺序不合法')
        const bytes = Buffer.from(r.data, 'base64'); if (!bytes.length || bytes.length > 256 * 1024 || upload.received + bytes.length > upload.bytes) throw new Error('上传大小不合法')
        upload.chunks.push(bytes); upload.received += bytes.length; upload.created = Date.now(); return { received: upload.received }
      }
      case 'upload.cancel': { const { id } = idInput.parse(input); if (this.uploads.get(id)?.sessionId === sessionId) this.uploads.delete(id); return {} }
      case 'upload.finish': {
        const { id } = idInput.parse(input), upload = this.uploads.get(id)
        if (!upload || upload.sessionId !== sessionId || upload.received !== upload.bytes) throw new Error('文件尚未完整上传')
        this.uploads.delete(id); return this.documents.importBytes(Buffer.concat(upload.chunks), upload.name)
      }
      case 'query.preview': return this.queries.data(input, AbortSignal.any([signal, this.shutdown.signal]))
      case 'query.answer': { QuerySchema.parse(input); return this.operation(sessionId, (s, emit, id) => this.generation.answer(input, { signal: s, emit, requestId: id })) }
      case 'graph.browse': { const q = GraphQuerySchema.parse(input ?? {}); return { ...view.browseGraph(q.q, q.nodeId, q.limit, q.kind), corpusRevision: view.corpusRevision } }
      case 'graph.catalog': { const q = GraphCatalogQuerySchema.parse(input); return { ...view.graphCatalog(q.kind, q.offset, q.limit), corpusRevision: view.corpusRevision } }
      case 'graph.select': { const q = GraphSelectionSchema.parse(input); return { ...view.graphSelection(q.nodeIds, q.edgeIds), corpusRevision: view.corpusRevision } }
      case 'graph.sources': return graphSources(view, GraphSourcesQuerySchema.parse(input))
      case 'chat.list': return this.conversations.list()
      case 'chat.create': return this.conversations.create()
      case 'chat.get': return this.conversations.get(idInput.parse(input).id)
      case 'chat.delete': await this.conversations.remove(idInput.parse(input).id); return {}
      case 'chat.cancel': return this.conversations.cancel(idInput.parse(input).id)
      case 'chat.send': {
        const r = z.object({ id: IdSchema, request: z.unknown() }).parse(input)
        return this.operation(sessionId, async (s, emit, id) => {
          s.throwIfAborted()
          const conversation = await this.conversations.begin(r.id, r.request)
          return this.conversations.run(conversation, id, s, emit)
        })
      }
      default: throw new Error('不支持的知识库操作')
    }
  }
  async close() {
    this.shutdown.abort(); this.offSwitch(); this.uploads.clear()
    for (const op of this.operations.values()) op.controller.abort()
    await Promise.allSettled([...this.pending])
    await Promise.allSettled([...this.operations.values()].map(op => op.task))
    await this.conversations.close(); await this.documents.close(); await this.sessions.close(); await this.models.metadata.close(); await this.storage.close()
  }
}

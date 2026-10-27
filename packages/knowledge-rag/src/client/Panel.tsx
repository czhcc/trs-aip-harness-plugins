import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import ReactMarkdown from 'react-markdown'
import { z } from 'zod'
import { ConversationSchema, ChatSettingsSchema, DocumentListSchema, DocumentDetailSchema, GraphDataSchema, GraphCatalogSchema, GraphSourcesSchema, ModelSettingsSchema, MaintenanceStateSchema, QueryDataSchema } from '../contracts/index.js'
import type { Conversation, GraphData, GraphCatalog, QueryData, StreamEvent } from '../contracts/index.js'
import { graphLayout, type GraphLayout } from '../graph-layout.js'
import { stream, upload, type RagApi } from './api.js'

import { ConfirmProvider, useConfirm } from './Confirm.js'

const B = Button
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
type Tab = 'chat' | 'query' | 'graph' | 'documents'
export interface PanelProps { api: RagApi; expand: (element: HTMLElement) => void }
export function Markdown({ text }: { text: string }) {
  return <ReactMarkdown skipHtml components={{ img: () => null, a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{text}</ReactMarkdown>
}
export function SessionSwitch({ api }: { api: RagApi }) {
  const [enabled, setEnabled] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false), generation = useRef(0), changing = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    const load = () => {
      if (changing.current) return
      const version = ++generation.current
      void api.call<{ enabled: boolean }>('session.get', undefined, controller.signal).then(v => {
        if (!controller.signal.aborted && generation.current === version) { setEnabled(v.enabled); setLoaded(true); setError('') }
      }).catch(e => { if (!controller.signal.aborted && generation.current === version) setError(message(e)) })
    }
    load(); const timer = setInterval(load, 2500)
    return () => { controller.abort(); clearInterval(timer) }
  }, [api])
  return <div className="row"><B size="sm" variant="outline" disabled={busy || !loaded} aria-pressed={enabled} onClick={() => {
    changing.current = true; generation.current++; setBusy(true); setError('')
    void api.call<{ enabled: boolean }>('session.set', { enabled: !enabled }).then(v => setEnabled(v.enabled)).catch(e => setError(message(e))).finally(() => { generation.current++; changing.current = false; setBusy(false) })
  }}>知识库：{enabled ? '自动使用' : '关闭'}</B>{error && <span role="alert" className="error">{error}</span>}</div>
}
export function Panel(props: PanelProps) { return <ConfirmProvider><PanelContent {...props}/></ConfirmProvider> }
function PanelContent({ api, expand }: PanelProps) {
  const [tab, setTab] = useState<Tab>('documents'), [docId, setDocId] = useState<string>()
  const source = useCallback((id: string) => { setDocId(id); setTab('documents') }, [])
  return <section className="trs-rag" aria-label="知识库">
    <p className="muted">作用于当前 DSH 对话；关闭后，历史中已有的知识库内容仍会保留。</p><SessionSwitch api={api}/>
    <nav aria-label="知识库功能" role="tablist">{([['chat', '知识问答'], ['query', '检索预览'], ['graph', '知识图谱'], ['documents', '文档']] as const).map(([id, title]) => <B role="tab" aria-selected={tab === id} key={id} size="sm" variant="outline" onClick={() => setTab(id)}>{title}</B>)}<B size="sm" variant="outline" onClick={e => expand(e.currentTarget)}>展开 / 收起</B></nav>
    <div role="tabpanel" hidden={tab !== 'chat'}><Chat api={api} source={source}/></div>
    <div role="tabpanel" hidden={tab !== 'query'}><Query api={api} source={source}/></div>
    <div role="tabpanel" hidden={tab !== 'graph'}><Graph api={api} source={source} active={tab === 'graph'}/></div>
    <div role="tabpanel" hidden={tab !== 'documents'}><Documents api={api} selected={docId}/></div>
  </section>
}

function References({ references, source }: { references: QueryData['references']; source: (id: string) => void }) {
  return <div className="refs">{references.map(r => <details key={r.id}><summary>[{r.id}] {r.fileName}</summary>{r.location && <pre>{r.location}</pre>}{r.content && <pre>{r.content}</pre>}<B size="sm" variant="outline" onClick={() => source(r.documentId)}>查看来源文档</B></details>)}</div>
}
function QueryOptions({ mode, setMode, rerank, setRerank }: { mode: string; setMode: (s: string) => void; rerank: boolean; setRerank: (b: boolean) => void }) {
  return <div className="row"><label>检索模式<select value={mode} onChange={e => setMode(e.target.value)}>{['naive', 'local', 'global', 'hybrid', 'mix'].map(m => <option key={m}>{m}</option>)}</select></label><label><span><input type="checkbox" checked={rerank} onChange={e => setRerank(e.target.checked)}/> 使用重排（需配置）</span></label></div>
}
function Query({ api, source }: { api: RagApi; source: (id: string) => void }) {
  const [question, setQuestion] = useState(''), [mode, setMode] = useState('mix'), [rerank, setRerank] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [data, setData] = useState<QueryData>(), [answer, setAnswer] = useState(''), [warnings, setWarnings] = useState<string[]>([])
  const active = useRef<AbortController>()
  useEffect(() => () => active.current?.abort(), [])
  const run = async (generate: boolean) => {
    active.current?.abort(); const controller = new AbortController(); active.current = controller
    setBusy(true); setError(''); setAnswer(''); setWarnings([])
    const query = { query: question, mode, enableRerank: rerank }
    try {
      if (!generate) setData(QueryDataSchema.parse(await api.call('query.preview', { ...query, onlyNeedContext: true }, controller.signal)))
      else await stream(api, 'query.answer', query, controller.signal, event => {
        if (event.type === 'delta') setAnswer(t => t + event.text)
        if (event.type === 'done') { setData(event.data); setWarnings(event.warnings) }
        if (event.type === 'error') setError(event.error.message)
        if (event.type === 'cancelled') setError('已停止，以上内容可能不完整')
      })
    } catch (e) { setError(controller.signal.aborted ? '已停止，以上内容可能不完整' : message(e)) }
    finally { if (active.current === controller) setBusy(false) }
  }
  return <><h2>检索预览</h2><label>查询<textarea aria-label="查询" value={question} onChange={e => setQuestion(e.target.value)}/></label><QueryOptions mode={mode} setMode={setMode} rerank={rerank} setRerank={setRerank}/><div className="row"><B size="sm" disabled={busy || !question.trim()} onClick={() => void run(false)}>检索证据</B><B size="sm" variant="outline" disabled={busy || !question.trim()} onClick={() => void run(true)}>生成回答</B>{busy && <B size="sm" variant="outline" onClick={() => active.current?.abort()}>停止</B>}</div>{error && <p className="error" role="alert">{error}</p>}{answer && <article className="card"><Markdown text={answer}/></article>}{warnings.map((w, i) => <p className="warning" key={i}>{w}</p>)}{data && <><p>{data.status === 'empty' ? '未找到相关证据' : '检索完成'}</p><References references={data.references} source={source}/><details><summary>上下文、提示词与预算</summary><pre>{JSON.stringify(data, null, 2)}</pre></details></>}</>
}

function Chat({ api, source }: { api: RagApi; source: (id: string) => void }) {
  const confirm = useConfirm()
  const [items, setItems] = useState<{ id: string; title: string }[]>([]), [current, setCurrent] = useState<Conversation>(), [question, setQuestion] = useState(''), [mode, setMode] = useState('mix'), [rerank, setRerank] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [partial, setPartial] = useState('')
  const active = useRef<AbortController>()
  const list = useCallback(async () => { const r = await api.call<{ id: string; title: string }[]>('chat.list'); setItems(r) }, [api])
  const load = async (id: string) => setCurrent(ConversationSchema.parse(await api.call('chat.get', { id })))
  useEffect(() => { void list().catch(e => setError(message(e))); return () => active.current?.abort() }, [list])
  const send = async () => {
    const controller = new AbortController(); active.current = controller; setBusy(true); setError(''); setPartial('')
    let c = current
    try {
      if (!c) c = ConversationSchema.parse(await api.call('chat.create', undefined, controller.signal))
      setCurrent(c)
      await stream(api, 'chat.send', { id: c.id, request: { question, expectedRevision: c.revision, settings: ChatSettingsSchema.parse({ mode, enableRerank: rerank }) } }, controller.signal, (event: StreamEvent) => {
        if (event.type === 'delta') setPartial(t => t + event.text)
        if (event.type === 'error') setError(event.error.message)
        if (event.type === 'cancelled') setError('回答已停止')
      })
      setQuestion(''); await load(c.id); setPartial(''); await list()
    } catch (e) {
      setError(controller.signal.aborted ? '回答已停止，保留已接收内容' : message(e))
      if (c) {
        try {
          if (controller.signal.aborted) await api.call('chat.cancel', { id: c.id })
          for (let i = 0; i < 30; i++) {
            const latest = ConversationSchema.parse(await api.call('chat.get', { id: c.id }))
            setCurrent(latest)
            if (latest.turns.at(-1)?.status !== 'generating') { setPartial(''); break }
            await new Promise(resolve => setTimeout(resolve, 100))
          }
        } catch { /* Keep received text visible if the Host disconnected. */ }
      }
    }
    finally { setBusy(false) }
  }
  return <><h2>知识问答</h2><div className="row"><select aria-label="知识库对话" disabled={busy} value={current?.id ?? ''} onChange={e => { if (e.target.value) void load(e.target.value).catch(e => setError(message(e))) }}><option value="">新对话</option>{items.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select><B size="sm" variant="outline" disabled={busy} onClick={() => { setCurrent(undefined); setPartial('') }}>新建</B>{current && <B size="sm" variant="outline" disabled={busy} onClick={async () => { if (await confirm('删除此知识库对话？')) void api.call('chat.delete', { id: current.id }).then(() => { setCurrent(undefined); return list() }).catch(e => setError(message(e))) }}>删除</B>}</div>{current?.turns.map(t => <article className="card" key={t.id}><strong>{t.question}</strong><Markdown text={t.answer}/><p className="muted">{t.status}{t.error ? `：${t.error}` : ''}</p>{t.warnings.map((w, i) => <p className="warning" key={i}>{w}</p>)}<References references={t.references} source={source}/></article>)}{partial && <article className="card" aria-live="polite"><Markdown text={partial}/></article>}<label>问题<textarea aria-label="知识库问题" value={question} disabled={busy} onChange={e => setQuestion(e.target.value)}/></label><QueryOptions mode={mode} setMode={setMode} rerank={rerank} setRerank={setRerank}/><div className="row"><B size="sm" disabled={busy || !question.trim()} onClick={() => void send()}>发送</B>{busy && <B size="sm" variant="outline" onClick={() => active.current?.abort()}>停止</B>}</div>{error && <p className="error" role="alert">{error}</p>}</>
}

function Documents({ api, selected }: { api: RagApi; selected?: string }) {
  const confirm = useConfirm()
  const [page, setPage] = useState<z.infer<typeof DocumentListSchema>>(), [offset, setOffset] = useState(0), [q, setQ] = useState(''), [status, setStatus] = useState(''), [name, setName] = useState('文档.txt'), [text, setText] = useState(''), [detail, setDetail] = useState<z.infer<typeof DocumentDetailSchema>>(), [parsed, setParsed] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const active = useRef<AbortController>()
  const refresh = useCallback(async (signal?: AbortSignal) => { setPage(DocumentListSchema.parse(await api.call('documents.list', { offset, limit: 20, q, ...(status ? { status } : {}) }, signal))) }, [api, offset, q, status])
  useEffect(() => { const c = new AbortController(); void refresh(c.signal).catch(e => { if (!c.signal.aborted) setError(message(e)) }); const timer = setInterval(() => { void refresh(c.signal).catch(() => {}) }, 2500); return () => { c.abort(); clearInterval(timer) } }, [refresh])
  useEffect(() => () => active.current?.abort(), [])
  const show = useCallback(async (id: string, reset = true) => { const d = DocumentDetailSchema.parse(await api.call('documents.detail', { id })); setDetail(d); if (reset) setParsed(''); return d }, [api])
  useEffect(() => { if (selected) void show(selected).catch(e => setError(message(e))) }, [selected, show])
  const work = async (run: (signal: AbortSignal) => Promise<unknown>) => { const c = new AbortController(); active.current = c; setBusy(true); setError(''); try { await run(c.signal); await refresh(); if (detail) await show(detail.document.id, false) } catch (e) { setError(message(e)) } finally { setBusy(false) } }
  const retryMaintenance = async (signal: AbortSignal) => {
    if (!detail?.job) return
    const raw = await api.call<{ models: unknown; maintenance: unknown }>('status', undefined, signal)
    const models = ModelSettingsSchema.parse(raw.models), state = MaintenanceStateSchema.parse(raw.maintenance)
    return api.call('jobs.retry', { id: detail.job.id, request: {
      expectedCorpusRevision: state.corpusRevision, expectedConfigRevision: models.revision,
      expectedDocumentVersion: detail.document.version,
      ...(detail.job.operation === 'rebuild' ? { targetProfileId: models.bindings.embedding } : {}),
    } }, signal)
  }
  const maintenance = async (operation: 'delete' | 'reindex' | 'rebuild', id: string | null, version?: number) => {
    if (!await confirm(operation === 'delete' ? '确认删除文档及其索引贡献？历史快照可能仍保留原文。' : operation === 'rebuild' ? '完整重建向量索引可能调用模型并计费，确认继续？' : '重新索引可能调用模型并计费，确认继续？')) return
    await work(async signal => {
      const raw = await api.call<{ models: unknown; maintenance: unknown }>('status', undefined, signal), models = ModelSettingsSchema.parse(raw.models), state = MaintenanceStateSchema.parse(raw.maintenance)
      return api.call('maintenance', { operation, id, request: { expectedCorpusRevision: state.corpusRevision, expectedConfigRevision: models.revision, ...(version ? { expectedDocumentVersion: version } : {}), ...(operation === 'rebuild' ? { targetProfileId: models.bindings.embedding } : {}) } }, signal)
    })
  }
  return <><h2>文档</h2><p className="muted">本地解析；建库时文本会发送至 DSH 文本模型和配置的向量服务。最大文件 20 MiB，扫描 PDF 不支持 OCR。</p><label>导入文件<input type="file" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void work(s => upload(api, file, s)); e.target.value = '' }}/></label><details><summary>粘贴文本</summary><label>文件名<input value={name} onChange={e => setName(e.target.value)}/></label><label>正文<textarea aria-label="粘贴文档正文" value={text} onChange={e => setText(e.target.value)}/></label><B size="sm" disabled={busy || !text.trim()} onClick={() => void work(s => api.call('documents.text', { name, text }, s))}>导入文本</B></details><div className="row"><input aria-label="文档名称过滤" placeholder="搜索文档名称" value={q} onChange={e => { setQ(e.target.value); setOffset(0) }}/><select aria-label="索引状态过滤" value={status} onChange={e => { setStatus(e.target.value); setOffset(0) }}><option value="">全部状态</option>{['processed','failed','awaiting_configuration','interrupted','cancelled','queued','parsing','extracting','embedding'].map(s => <option key={s}>{s}</option>)}</select><B size="sm" variant="outline" onClick={() => void refresh().catch(e => setError(message(e)))}>刷新</B></div>{error && <p role="alert" className="error">{error}</p>}{page?.items.map(d => <article className="card" key={d.id}><strong>{d.name}</strong><p>{d.status} · v{d.version}</p><div className="row"><B size="sm" variant="outline" onClick={() => void show(d.id).catch(e => setError(message(e)))}>查看</B><B size="sm" variant="outline" disabled={busy} onClick={() => void maintenance('reindex', d.id, d.version)}>重新索引</B><B size="sm" variant="outline" disabled={busy} onClick={() => void maintenance('delete', d.id, d.version)}>删除</B></div></article>)}{page && !page.total && <p>暂无文档</p>}<div className="row"><B size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 20))}>上一页</B><span>共 {page?.total ?? 0} 项</span><B size="sm" variant="outline" disabled={!page || offset + 20 >= page.total} onClick={() => setOffset(offset + 20)}>下一页</B></div>{detail && <section className="card"><h3>{detail.document.name}</h3><p>{detail.job?.status} · {detail.job?.phase}</p>{detail.job?.error && <p role="alert" className="error">{detail.job.error}</p>}{detail.job?.warnings?.map((w, i) => <p className="warning" key={i}>{w.message}</p>)}<div className="row"><B size="sm" variant="outline" onClick={() => void show(detail.document.id).catch(e => setError(message(e)))}>刷新详情</B><B size="sm" variant="outline" onClick={() => void work(async s => { const p = await api.call('documents.parsed', { id: detail.document.id }, s); setParsed(JSON.stringify(p, null, 2)) })}>解析预览</B>{detail.job && <><B size="sm" variant="outline" disabled={busy} onClick={() => void work(s => api.call('jobs.cancel', { id: detail.job!.id }, s))}>取消任务</B><B size="sm" variant="outline" disabled={busy} onClick={() => void work(s => detail.job!.operation === 'index' ? api.call('documents.retry', { id: detail.document.id, expectedJobId: detail.job!.id }, s) : retryMaintenance(s))}>重试</B></>}</div>{parsed && <pre>{parsed}</pre>}</section>}<details><summary>索引维护</summary><p>修改向量模型、维度或版本后，需要完整重建。重建期间旧索引继续使用原向量服务；失败不替换旧索引。</p><B size="sm" variant="outline" disabled={busy} onClick={() => void maintenance('rebuild', null)}>完整重建向量索引</B><B size="sm" variant="outline" disabled={busy} onClick={() => void work(s => api.call('cleanup', undefined, s))}>重试文件释放</B><MaintenanceJobs api={api}/></details></>
}

function MaintenanceJobs({ api }: { api: RagApi }) {
  const confirm = useConfirm()
  const [state, setState] = useState<z.infer<typeof MaintenanceStateSchema>>(), [models, setModels] = useState<z.infer<typeof ModelSettingsSchema>>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const result = await api.call<{ models: unknown; maintenance: unknown }>('status', undefined, signal)
    setState(MaintenanceStateSchema.parse(result.maintenance)); setModels(ModelSettingsSchema.parse(result.models))
  }, [api])
  useEffect(() => {
    const controller = new AbortController()
    const load = () => { void refresh(controller.signal).catch(e => { if (!controller.signal.aborted) setError(message(e)) }) }
    load(); const timer = setInterval(load, 2500)
    return () => { controller.abort(); clearInterval(timer) }
  }, [refresh])
  const retry = async (job: NonNullable<typeof state>['jobs'][number]) => {
    const result = await api.call<{ models: unknown; maintenance: unknown }>('status')
    const config = ModelSettingsSchema.parse(result.models), latest = MaintenanceStateSchema.parse(result.maintenance)
    const doc = job.documentId ? DocumentDetailSchema.parse(await api.call('documents.detail', { id: job.documentId })).document : undefined
    return api.call('jobs.retry', { id: job.id, request: { expectedCorpusRevision: latest.corpusRevision, expectedConfigRevision: config.revision, ...(doc ? { expectedDocumentVersion: doc.version } : {}), ...(job.operation === 'rebuild' ? { targetProfileId: config.bindings.embedding } : {}) } })
  }
  const run = (task: () => Promise<unknown>) => { setBusy(true); setError(''); void task().then(() => refresh()).catch(e => setError(message(e))).finally(() => setBusy(false)) }
  return <section><p className="muted">当前索引：{models?.activeIndex?.profile.model ?? '尚未建立'}；配置版本：{models?.revision ?? '…'}</p>{models?.activeIndex && models.bindings.embedding !== models.activeIndex.profile.id && <p className="warning">向量配置已变更，当前检索仍使用旧索引配置。请完整重建以切换。</p>}{error && <p className="error" role="alert">{error}</p>}{state?.jobs.slice(0, 20).map(job => <article className="card" key={job.id}><strong>{job.operation} · {job.status}</strong><p className="muted">{job.id} · {job.phase}</p>{job.error && <p className="error">{job.error}</p>}{['queued','parsing','chunking','extracting','embedding','committing'].includes(job.status) && <B size="sm" variant="outline" disabled={busy} onClick={() => run(() => api.call('jobs.cancel', { id: job.id }))}>取消维护</B>}{['failed','cancelled','interrupted','awaiting_configuration'].includes(job.status) && <B size="sm" variant="outline" disabled={busy} onClick={async () => { if (await confirm('重试此维护任务可能调用模型并计费，继续？')) run(() => retry(job)) }}>重试维护</B>}</article>)}{state?.cleanupTasks.filter(t => t.status !== 'done').slice(0, 20).map(task => <p className="muted" key={task.id}>文件释放：{task.status} · {task.error}</p>)}</section>
}

function Graph({ api, source, active }: { api: RagApi; source: (id: string) => void; active: boolean }) {
  const [q, setQ] = useState(''), [kind, setKind] = useState<'nodes' | 'edges'>('nodes'), [layout, setLayout] = useState<GraphLayout>('force'), [data, setData] = useState<GraphData>(), [catalog, setCatalog] = useState<GraphCatalog>(), [offset, setOffset] = useState(0), [selected, setSelected] = useState<string[]>([]), [sources, setSources] = useState<z.infer<typeof GraphSourcesSchema>>(), [target, setTarget] = useState<{ id: string; kind: 'node' | 'edge' }>(), [error, setError] = useState('')
  const points = useMemo(() => graphLayout(data?.nodes ?? [], data?.edges ?? [], layout), [data, layout])
  const [loading, setLoading] = useState(false)
  const latestData = useRef(data)
  useEffect(() => { latestData.current = data }, [data])
  useEffect(() => {
    if (!active || latestData.current?.nodes.length) return
    const controller = new AbortController()
    setLoading(true); setError('')
    void api.call('graph.browse', { q: '', kind: 'nodes', limit: 100 }, controller.signal).then(value => {
      if (!controller.signal.aborted) setData(GraphDataSchema.parse(value))
    }).catch(e => { if (!controller.signal.aborted) setError(message(e)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); setLoading(false) }
  }, [api, active])
  const merge = (next: GraphData) => setData(old => {
    if (!old || old.corpusRevision !== next.corpusRevision) return next
    const nodes = [...new Map([...old.nodes, ...next.nodes].map(n => [n.id, n])).values()], edges = [...new Map([...old.edges, ...next.edges].map(n => [n.id, n])).values()]
    if (nodes.length > 500 || edges.length > 1500) { setError('关联图已达 500 节点 / 1500 关系上限，请清空后继续'); return old }
    return { ...next, nodes, edges }
  })
  const browse = async (nodeId?: string) => merge(GraphDataSchema.parse(await api.call('graph.browse', { q: nodeId ? '' : q, kind, limit: 100, ...(nodeId ? { nodeId } : {}) })))
  const loadCatalog = useCallback(async (signal?: AbortSignal) => { setCatalog(GraphCatalogSchema.parse(await api.call('graph.catalog', { kind, offset, limit: 10 }, signal))) }, [api, kind, offset])
  useEffect(() => { if (!active) return; const c = new AbortController(); void loadCatalog(c.signal).catch(e => { if (!c.signal.aborted) setError(message(e)) }); return () => c.abort() }, [loadCatalog, active])
  const inspect = async (id: string, k: 'node' | 'edge', pageOffset = 0) => { setTarget({ id, kind: k }); setSources(GraphSourcesSchema.parse(await api.call('graph.sources', { id, kind: k, offset: pageOffset, limit: 10 }))) }
  const refreshGraph = async () => {
    const nodeIds = data?.nodes.map(n => n.id) ?? [], edgeIds = data?.edges.map(e => e.id) ?? []
    setData(undefined); setSources(undefined); setTarget(undefined); setSelected([])
    if (!nodeIds.length && !edgeIds.length) setData(GraphDataSchema.parse(await api.call('graph.browse', { q: '', kind: 'nodes', limit: 100 })))
    for (let offset = 0; offset < Math.max(nodeIds.length, edgeIds.length); offset += 100) {
      const next = await api.call('graph.select', { nodeIds: nodeIds.slice(offset, offset + 100), edgeIds: edgeIds.slice(offset, offset + 100) })
      merge(GraphDataSchema.extend({ nodes: GraphDataSchema.shape.nodes.max(300) }).parse(next))
    }
    await loadCatalog()
  }
  const attempt = (p: Promise<unknown>) => { setError(''); void p.catch(e => setError(message(e))) }
  return <><h2>知识图谱</h2><div className="row"><input aria-label="图谱搜索" value={q} onChange={e => setQ(e.target.value)} placeholder="实体名称或关系描述"/><select aria-label="搜索类型" value={kind} onChange={e => { setKind(e.target.value as typeof kind); setOffset(0); setSelected([]) }}><option value="nodes">实体</option><option value="edges">关系</option></select><B size="sm" disabled={loading} onClick={() => attempt(browse())}>搜索</B><B size="sm" variant="outline" disabled={loading} onClick={() => { setData(undefined); setSources(undefined); setTarget(undefined) }}>清空图谱</B><B size="sm" variant="outline" disabled={loading} onClick={() => { setLoading(true); attempt(refreshGraph().finally(() => setLoading(false))) }}>刷新图谱</B></div><label>布局<select value={layout} onChange={e => setLayout(e.target.value as GraphLayout)}>{(['force','circle','grid','hierarchy'] as const).map(v => <option key={v}>{v}</option>)}</select></label>{error && <p className="error" role="alert">{error}</p>}{loading && <p role="status">正在加载知识图谱…</p>}{!loading && !data?.nodes.length && <p role="status">{!data ? '关联图已清空，可点击“刷新图谱”加载初始节点，或搜索、从目录选择实体。' : data.totalNodes === 0 ? '当前索引尚无实体，请确认文档已完成索引，并查看文档任务的抽取警告。' : '未找到匹配节点，请调整搜索条件，或点击“刷新图谱”加载初始节点。'}</p>}{data?.truncated && <p className="muted">当前仅展示部分节点；可搜索具体实体或从目录选择后加入关联图。</p>}<svg className="graph" viewBox="0 0 1000 650" aria-label="知识关联图">{data?.edges.map(e => { const a = points.get(e.sourceId), b = points.get(e.targetId); return a && b ? <g key={e.id} role="button" tabIndex={0} aria-label={e.description} onClick={() => attempt(inspect(e.id, 'edge'))} onKeyDown={ev => { if (ev.key === 'Enter') attempt(inspect(e.id, 'edge')) }}><title>{e.description}</title><line x1={a.x} y1={a.y} x2={b.x} y2={b.y}/></g> : null })}{data?.nodes.map(n => { const p = points.get(n.id)!; return <g key={n.id} role="button" tabIndex={0} aria-label={`${n.name} ${n.type}`} onClick={() => attempt(inspect(n.id, 'node'))} onDoubleClick={() => attempt(browse(n.id))} onKeyDown={e => { if (e.key === 'Enter') attempt(inspect(n.id, 'node')) }}><title>{n.type}：{n.description}</title><circle cx={p.x} cy={p.y} r={15}/><text x={p.x} y={p.y + 32} textAnchor="middle">{n.name.slice(0, 16)}</text></g> })}</svg><p className="muted">{data?.nodes.length ?? 0} 个节点 · {data?.edges.length ?? 0} 条关系。双击实体展开一层邻居。</p>{target && <section className="card"><h3>属性与来源</h3><pre>{JSON.stringify(target.kind === 'node' ? (data?.nodes.find(n => n.id === target.id) ?? catalog?.items.find(n => n.id === target.id)) : (data?.edges.find(e => e.id === target.id) ?? catalog?.items.find(n => n.id === target.id)), null, 2)}</pre>{target.kind === 'node' && <B size="sm" variant="outline" onClick={() => attempt(browse(target.id))}>展开邻居</B>}{sources?.items.map(s => <details key={s.chunk.id}><summary>{s.fileName} · v{s.documentVersion}</summary><pre>{s.chunk.content}</pre><B size="sm" variant="outline" onClick={() => source(s.chunk.docId)}>查看文档</B></details>)}{sources && <div className="row"><B size="sm" variant="outline" disabled={!sources.offset} onClick={() => attempt(inspect(target.id, target.kind, sources.offset - 10))}>上一页来源</B><span>共 {sources.total} 项</span><B size="sm" variant="outline" disabled={sources.offset + 10 >= sources.total} onClick={() => attempt(inspect(target.id, target.kind, sources.offset + 10))}>下一页来源</B></div>}</section>}<h3>全量{kind === 'nodes' ? '实体' : '关系'}目录</h3>{catalog && !catalog.total && <p className="muted">当前目录没有{kind === 'nodes' ? '实体' : '关系'}。</p>}{catalog?.items.map(n => <div className="card" key={n.id}><label><span><input type="checkbox" checked={selected.includes(n.id)} onChange={e => setSelected(old => e.target.checked ? old.length < 100 ? [...old, n.id] : old : old.filter(id => id !== n.id))}/>{'name' in n ? n.name : n.description}</span></label><B size="sm" variant="outline" onClick={() => attempt(inspect(n.id, kind === 'nodes' ? 'node' : 'edge'))}>属性与来源</B></div>)}<div className="row"><B size="sm" variant="outline" disabled={!selected.length} onClick={() => attempt(api.call('graph.select', { nodeIds: kind === 'nodes' ? selected : [], edgeIds: kind === 'edges' ? selected : [] }).then(v => merge(GraphDataSchema.extend({ nodes: GraphDataSchema.shape.nodes.max(300) }).parse(v))))}>所选加入关联图（{selected.length}）</B><B size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 10))}>上一页</B><span>共 {catalog?.total ?? 0} 项</span><B size="sm" variant="outline" disabled={!catalog || offset + 10 >= catalog.total} onClick={() => setOffset(offset + 10)}>下一页</B></div></>
}

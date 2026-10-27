import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { createAssistantMessage, createSystemMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { ModelConfigStore } from './engine/models/config.js'
import { ModelClient, type Message, type ChatResult } from './engine/models/client.js'
import { ModelError } from './engine/models/errors.js'
import type { ModelProfileInput } from './contracts/index.js'
import type { Config } from './settings.js'

const identity = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 24)
export class DshModels {
  private tail: Promise<unknown> = Promise.resolve()
  private textInfo = new Map<string, Awaited<ReturnType<Context['llm']['resolveModelInfo']>>>()
  readonly client: ModelClient
  invalidate() { this.textInfo.clear() }
  constructor(private ctx: Context, private settings: Config, readonly metadata: ModelConfigStore) {
    this.client = new ModelClient((profile, messages, options) => this.chat(profile, messages, options), async ref => {
      const value = await ctx.credentials.resolve(credentialRef(ref))
      if (!value) throw new ModelError('CREDENTIAL_UNAVAILABLE', '模型凭据引用不可用，请在 DSH 凭据设置中配置', 409)
      return value.value
    })
  }
  sync(): Promise<void> {
    const work = this.tail.then(async () => {
      const profiles: ModelProfileInput[] = []
      const base = { timeoutMs: 60000, maxConcurrency: 2, maxRetries: 2, retryBaseMs: 200, maxRetryDelayMs: 5000, apiKey: null }
      const text = this.settings.text.get()
      const selection = text.provider && text.model ? { provider: text.provider, model: text.model } : this.ctx.agentDefaultModel.currentSelection()
      // Invalid or absent text routes must not prevent local document management.
      if (selection.provider && selection.model) {
        const key = identity(selection)
        const info = this.textInfo.get(key) ?? await this.ctx.llm.resolveModelInfo(selection.provider, selection.model).catch(() => undefined)
        if (info) {
          this.textInfo.clear(); this.textInfo.set(key, info)
          const contextTokens = info.context?.contextWindow ?? 32768
          profiles.push({ ...base, id: `text-${identity([selection, contextTokens, info.defaultMaxTokens])}`, name: 'DSH 文本模型', kind: 'text', protocol: 'openai-compatible', endpoint: 'http://dsh.invalid', model: selection.model, provider: selection.provider, reasoningEffort: selection.reasoningEffort, contextTokens: Math.min(contextTokens, 2000000), maxOutputTokens: Math.min(info.defaultMaxTokens ?? 4096, 131072, Math.max(1, Math.floor(contextTokens / 2))), tokenizer: 'cl100k_base', temperature: 0 })
        }
      }
      const embedding = this.settings.embedding.get(), rerank = this.settings.rerank.get()
      if (embedding.endpoint && embedding.model) profiles.push({ ...base, ...embedding, id: `embedding-${identity(embedding)}`, name: '向量模型', kind: 'embedding', protocol: 'openai-compatible' })
      if (rerank.enabled && rerank.endpoint && rerank.model) profiles.push({ ...base, ...rerank, id: `rerank-${identity(rerank)}`, name: '重排模型', kind: 'rerank', protocol: 'jina-compatible' })
      const current = this.metadata.capture()
      const bindings = { query: profiles.find(p => p.kind === 'text')?.id ?? null, extract: null, keyword: null, embedding: profiles.find(p => p.kind === 'embedding')?.id ?? null, rerank: profiles.find(p => p.kind === 'rerank')?.id ?? null }
      if (JSON.stringify(current.bindings) === JSON.stringify(bindings)) return
      const protectedIds = new Set<string>()
      const view = this.metadata.captureIndex().view
      if (view.indexBinding) protectedIds.add(view.indexBinding.profileId)
      for (const job of view.jobs()) if (['queued', 'parsing', 'chunking', 'extracting', 'embedding', 'committing'].includes(job.status)) {
        for (const id of Object.values(this.metadata.revision(job.configRevision).bindings)) if (id) protectedIds.add(id)
        if (job.maintenance?.targetProfileId) protectedIds.add(job.maintenance.targetProfileId)
      }
      const retained = current.profiles.filter(p => protectedIds.has(p.id) && !profiles.some(n => n.id === p.id))
      await this.metadata.save({ expectedRevision: current.revision, profiles: [...retained, ...profiles], bindings })
    })
    this.tail = work.catch(() => {})
    return work
  }
  private async chat(profile: Extract<ModelProfileInput, { kind: 'text' }>, messages: Message[], options: { signal?: AbortSignal; onDelta?: (text: string) => void | Promise<void> }): Promise<ChatResult> {
    options = { ...options, signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(profile.timeoutMs)]) }
    if (!profile.provider) throw new ModelError('MODEL_NOT_CONFIGURED', '未配置 DSH 文本模型', 409)
    const call = await this.ctx.llm.prepareCall({ provider: profile.provider, model: profile.model, temperature: profile.temperature, maxTokens: profile.maxOutputTokens, ...(profile.reasoningEffort ? { reasoningEffort: ReasoningEffortId(profile.reasoningEffort) } : {}) }, options.signal)
    let text = '', finishReason: 'stop' | 'length' | undefined
    const request = messages.map(m => m.role === 'system' ? createSystemMessage(m.content) : m.role === 'assistant' ? createAssistantMessage({ source: { provider: profile.provider!, model: profile.model }, content: [{ type: 'text', text: m.content }] }) : { role: 'user' as const, content: [{ type: 'text' as const, text: m.content }] })
    for await (const chunk of call.stream({ ...call.config, messages: request, signal: options.signal })) {
      options.signal?.throwIfAborted()
      if (chunk.type === 'text-delta') { text += chunk.text; await options.onDelta?.(chunk.text) }
      if (chunk.type === 'tool-call-delta') throw new ModelError('INVALID_MODEL_RESPONSE', '知识库文本任务不接受工具调用')
      if (chunk.type === 'finish') {
        if (chunk.reason.kind === 'stop') finishReason = 'stop'
        else if (chunk.reason.kind === 'max-tokens') finishReason = 'length'
        else throw new ModelError('MODEL_FAILED', 'DSH 模型调用未正常完成')
      }
    }
    if (!text.trim() || !finishReason) throw new ModelError('INVALID_MODEL_RESPONSE', 'DSH 模型未返回完整正文；思考内容不能替代正文')
    return { text, finishReason }
  }
}

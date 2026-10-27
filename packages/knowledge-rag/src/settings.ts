import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'
import { modelUrl } from './engine/models/url.js'

export const SETTINGS_NAMESPACE = 'trs-aip-knowledge-rag'
export interface TextSettings { provider: string; model: string }
export interface VectorSettings { endpoint: string; model: string; credentialRef: string; dimensions: number; batchSize: number; timeoutMs: number; operatorRevision: number }
export interface RerankSettings { enabled: boolean; endpoint: string; model: string; credentialRef: string; topN: number; timeoutMs: number; failurePolicy: 'fail' | 'fallback-with-warning' }
export interface RagSettings { text: TextSettings; embedding: VectorSettings; rerank: RerankSettings }
export interface Config { text: Volatile<TextSettings>; embedding: Volatile<VectorSettings>; rerank: Volatile<RerankSettings> }
export const Config = z.object({
  text: z.object({ provider: z.string().default(''), model: z.string().default('') }).volatile(),
  embedding: z.object({ endpoint: z.string().default(''), model: z.string().default(''), credentialRef: z.string().default(''), dimensions: z.number().step(1).min(1).max(65536).default(1024), batchSize: z.number().step(1).min(1).max(256).default(32), timeoutMs: z.number().step(1).min(100).max(600000).default(60000), operatorRevision: z.number().step(1).min(0).default(0) }).volatile(),
  rerank: z.object({ enabled: z.boolean().default(false), endpoint: z.string().default(''), model: z.string().default(''), credentialRef: z.string().default(''), topN: z.number().step(1).min(1).max(200).default(10), timeoutMs: z.number().step(1).min(100).max(600000).default(60000), failurePolicy: z.union(['fail', 'fallback-with-warning']).default('fallback-with-warning') }).volatile(),
}) as unknown as z<RagSettings, Config>

// Reject invalid settings before DSH writes a profile patch. Saving never calls a model.
const standard = Config['~standard']
Object.defineProperty(Config, '~standard', { value: {
  ...standard,
  validate(value: unknown) {
    const result = standard.validate(value)
    if ('then' in result || result.issues) return result
    const config = result.value as Config
    const embedding = config.embedding.get(), rerank = config.rerank.get()
    const errors: string[] = []
    const text = config.text.get()
    if ((text.provider || text.model) && (!text.provider.trim() || !text.model.trim())) errors.push('固定文本模型必须同时指定 DSH 服务商和模型')
    for (const [label, settings, kind] of [['向量', embedding, 'embedding'], ['重排', rerank, 'rerank']] as const) {
      if (settings.credentialRef && !/^[A-Za-z_][A-Za-z0-9_]{0,199}$/.test(settings.credentialRef)) errors.push(`${label}凭据引用必须为有效的环境变量名称`)
      if (settings.endpoint) try { modelUrl(settings.endpoint, kind) } catch { errors.push(`${label}接口地址必须为不含用户名、密码、查询参数的 HTTP(S) 地址`) }
      if ((kind === 'embedding' && (settings.endpoint || settings.model)) || (kind === 'rerank' && rerank.enabled)) {
        if (!settings.endpoint.trim() || !settings.model.trim()) errors.push(`${label}接口地址和模型名称必须同时填写`)
      }
    }
    return errors.length ? { issues: errors.map(message => ({ message })) } : result
  },
} })

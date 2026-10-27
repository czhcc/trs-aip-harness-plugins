import { z } from 'zod';
import type { PrivateProfile } from './config.js';
import { ModelError, invalid } from './errors.js';
import { ModelTransport, responseJson } from './http.js';

type TextProfile = Extract<PrivateProfile, { kind: 'text' }>;
type EmbeddingProfile = Extract<PrivateProfile, { kind: 'embedding' }>;
type RerankProfile = Extract<PrivateProfile, { kind: 'rerank' }>;
export type Message = { role: 'system' | 'user' | 'assistant'; content: string };
const Usage = z.object({ prompt_tokens: z.number().int().nonnegative().optional(),
  completion_tokens: z.number().int().nonnegative().optional(), total_tokens: z.number().int().nonnegative().optional() });
export type ChatResult = { text: string; finishReason: 'stop' | 'length'; usage?: z.infer<typeof Usage> };
export class ModelClient {
  private readonly transport: ModelTransport;
  constructor(private readonly textCall: (profile: TextProfile, messages: Message[], options: {signal?: AbortSignal; onDelta?: (text: string) => void | Promise<void>}) => Promise<ChatResult> = async () => { throw new ModelError('MODEL_NOT_CONFIGURED', '未配置 DSH 文本模型'); }, resolveCredential?: (ref: string) => Promise<string>) { this.transport = new ModelTransport(resolveCredential); }
  async chat(profile: TextProfile, messages: Message[], options: {signal?: AbortSignal; onDelta?: (text: string) => void | Promise<void>} = {}): Promise<ChatResult> { return this.textCall(profile, messages, options); }
  async embed(profile: EmbeddingProfile, input: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!input.length || input.length > 10_000 || input.some((s) => !s.trim())) throw new ModelError('INVALID_MODEL_INPUT', '向量输入不能为空或超过限制', 400);
    const result: number[][] = [];
    for (let start = 0; start < input.length; start += profile.batchSize) {
      const batch = input.slice(start, start + profile.batchSize);
      const rows = await this.transport.run(profile, { model: profile.model, input: batch, encoding_format: 'float' }, signal, async (response) => {
        const parsed = z.object({ data: z.array(z.object({ index: z.number().int().min(0).max(batch.length - 1),
          embedding: z.array(z.number().finite()).length(profile.dimensions) })).length(batch.length) }).safeParse(await responseJson(response));
        if (!parsed.success || new Set(parsed.data.data.map((r) => r.index)).size !== batch.length) throw invalid();
        const sorted = parsed.data.data.sort((a, b) => a.index - b.index).map((r) => r.embedding);
        for (const vector of sorted) {
          let norm = 0; for (const v of vector) norm = Math.hypot(norm, v);
          if (!norm || !Number.isFinite(norm)) throw invalid();
        }
        return sorted;
      });
      result.push(...rows);
    }
    return result;
  }
  async rerank(profile: RerankProfile | undefined, query: string, documents: string[], signal?: AbortSignal, enabled = profile?.enabled ?? false): Promise<{ results: { index: number; score: number }[]; warnings: string[] }> {
    if (!enabled) return { results: documents.map((_, index) => ({ index, score: 0 })), warnings: [] };
    if (!profile) throw new ModelError('MODEL_NOT_CONFIGURED', '重排已启用但未配置模型', 409);
    try {
      if (!query.trim() || !documents.length || documents.length > 1000) throw new ModelError('INVALID_MODEL_INPUT', '重排输入不合法', 400);
      const topN = Math.min(profile.topN, documents.length);
      const results = await this.transport.run(profile, { model: profile.model, query, documents, top_n: topN }, signal, async (response) => {
        const parsed = z.object({ results: z.array(z.object({ index: z.number().int().min(0).max(documents.length - 1), relevance_score: z.number().finite() })).length(topN) }).safeParse(await responseJson(response));
        if (!parsed.success || new Set(parsed.data.results.map((r) => r.index)).size !== topN) throw invalid();
        return parsed.data.results.map((r) => ({ index: r.index, score: r.relevance_score })).sort((a, b) => b.score - a.score);
      });
      return { results, warnings: [] };
    } catch (error) {
      if (signal?.aborted || (error instanceof ModelError && ['MODEL_CANCELLED', 'INVALID_MODEL_INPUT'].includes(error.code)) || profile.failurePolicy === 'fail') throw error;
      return { results: documents.map((_, index) => ({ index, score: 0 })), warnings: ['重排失败，按配置保留原始检索顺序'] };
    }
  }
  async test(profile: PrivateProfile, signal?: AbortSignal) {
    if (profile.kind === 'text') {
      const result = await this.chat(profile, [{ role: 'user', content: 'Reply with a short greeting. This is a connection test.' }], { ...(signal ? { signal } : {}) });
      if (result.finishReason === 'length') return { ok: true as const, kind: profile.kind, message: '模型协议测试通过，但回答达到最大输出 token 上限；请检查输出预算' };
    }
    if (profile.kind === 'embedding') {
      await this.embed(profile, ['TsLightRAG connection test'], signal);
      return { ok: true as const, kind: profile.kind, message: '向量协议测试通过', dimensions: profile.dimensions };
    }
    if (profile.kind === 'rerank') await this.rerank({ ...profile, enabled: true, failurePolicy: 'fail' }, 'graph retrieval', ['graph retrieval evidence', 'unrelated weather'], signal);
    return { ok: true as const, kind: profile.kind, message: '模型协议测试通过' };
  }
}

import type { InvocationDescriptor, RemoteResult, TypertRemoteContribution, TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { IdSchema } from './contracts/index.js'
export interface RagRequest { sessionId: string; action: string; input?: unknown }
export const RagRequestSchema = z.object({ sessionId: IdSchema, action: z.string().min(1).max(60), input: z.json().optional() }).strict()
export const RAG_SERVICE = 'trsAipRagController'
export const RAG_NAMESPACE = 'trsAipRag'
const descriptor: InvocationDescriptor = {
  id: '@trs-aip/dsh-knowledge-rag#request', service: RAG_SERVICE, namespace: RAG_NAMESPACE, method: 'request',
  invocation: { kind: 'direct' }, parameters: [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: '@trs-aip/dsh-knowledge-rag#RagRequest', create: () => RagRequestSchema } }],
  cancellation: { parameter: 'signal' }, result: { mode: 'src-json' },
}
export const RAG_REMOTE: TypertRemoteContribution = { package: '@trs-aip/dsh-knowledge-rag', descriptors: [descriptor] }
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap { 'trsAipRag/request': (request: RagRequest, signal?: AbortSignal) => Promise<RemoteResult<unknown>> }
  interface TypertRemoteNamespaceMap { trsAipRag: TypertRemoteNamespace<'trsAipRag'> }
}

import { z } from 'zod'
import { StreamEventSchema } from '../contracts/index.js'
import type { StreamEvent } from '../contracts/index.js'
export interface RagApi { call<T = unknown>(action: string, input?: unknown, signal?: AbortSignal): Promise<T> }
const operation = z.object({ id: z.string() })
const page = z.object({ events: z.array(StreamEventSchema), cursor: z.number(), done: z.boolean() })
const pause = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(signal.reason) }
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
})
/** Poll bounded DSH RPC frames; no HTTP listener or global fetch interception. */
export async function stream(api: RagApi, action: string, input: unknown, signal: AbortSignal, emit: (e: StreamEvent) => void) {
  const { id } = operation.parse(await api.call(action, input, signal))
  const cancel = () => { void api.call('operation.cancel', { id }).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    let cursor = 0
    while (true) {
      signal.throwIfAborted()
      const result = page.parse(await api.call('operation.poll', { id, cursor }, signal))
      for (const event of result.events) emit(event)
      cursor = result.cursor
      if (result.done) return
      await pause(120, signal)
    }
  } finally { signal.removeEventListener('abort', cancel); if (signal.aborted) cancel() }
}
export async function upload(api: RagApi, file: File, signal: AbortSignal) {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('文件必须介于 1 字节和 20 MiB')
  const { id } = operation.parse(await api.call('upload.begin', { name: file.name, bytes: file.size }, signal))
  try {
    for (let offset = 0; offset < file.size; offset += 192 * 1024) {
      signal.throwIfAborted()
      const bytes = new Uint8Array(await file.slice(offset, offset + 192 * 1024).arrayBuffer())
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      await api.call('upload.chunk', { id, offset, data: btoa(binary) }, signal)
    }
    return await api.call('upload.finish', { id }, signal)
  } finally { void api.call('upload.cancel', { id }).catch(() => {}) }
}

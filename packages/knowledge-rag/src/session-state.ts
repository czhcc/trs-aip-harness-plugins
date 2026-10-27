import { join } from 'node:path'
import { directory, readRegular, writeNew, syncDirectory } from './engine/storage/io.js'
import { rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
const schema = z.record(z.string().min(1).max(128), z.boolean())
/** A profile-local durable switch. Serialized writes commit before observers see a new state. */
export class SessionState {
  private values: Record<string, boolean> = {}
  private tail: Promise<void> = Promise.resolve()
  private listeners = new Set<(id: string) => void>()
  constructor(private root: string) {}
  async open() {
    await directory(this.root)
    try { this.values = schema.parse(JSON.parse(await readRegular(join(this.root, 'sessions.json')))) }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  }
  enabled(id: string) { return this.values[id] === true }
  onChange(listener: (id: string) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  set(id: string, enabled: boolean) {
    const work = this.tail.then(async () => {
      const next = { ...this.values }; if (enabled) next[id] = true; else delete next[id]
      if (Object.keys(next).length > 10000) throw new Error('知识库会话开关数量达到上限')
      const temp = join(this.root, `.sessions-${randomUUID()}.tmp`)
      try { await writeNew(temp, JSON.stringify(next)); await rename(temp, join(this.root, 'sessions.json')); this.values = next; await syncDirectory(this.root) }
      finally { await rm(temp, { force: true }) }
      for (const listener of this.listeners) listener(id)
    })
    this.tail = work.catch(() => {})
    return work
  }
  async close() { await this.tail }
}

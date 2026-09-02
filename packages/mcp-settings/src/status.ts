/** Honest runtime status: coordinator lifecycle plus observable global tool registrations. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type { McpServerSettings, McpSettings } from './model.js'

export type McpRuntimePhase =
  | 'disabled'
  | 'configured'
  | 'starting'
  | 'active'
  | 'tools-available'
  | 'restarting'
  | 'stopping'
  | 'activation-failed'

export interface McpServerRuntimeStatus {
  id: string
  serverName: string
  enabled: boolean
  phase: McpRuntimePhase
  toolCount: number
  message?: string
  updatedAt: number
}

export interface McpRuntimeSnapshot {
  revision: number
  servers: McpServerRuntimeStatus[]
}

/** Mutable Host-only directory projected as detached JSON through the status Remote. */
export class McpStatusDirectory {
  private readonly rows = new Map<string, McpServerRuntimeStatus>()
  private revision = 0

  constructor(private readonly ctx: Context) {}

  configure(settings: McpSettings): void {
    const next = new Map<string, McpServerRuntimeStatus>()
    for (const server of settings.servers) {
      const previous = this.rows.get(server.serverName)
      next.set(server.serverName, {
        id: server.id,
        serverName: server.serverName,
        enabled: server.enabled,
        phase: server.enabled
          ? previous?.phase === 'tools-available' || previous?.phase === 'active'
            ? previous.phase
            : 'configured'
          : 'disabled',
        toolCount: server.enabled ? previous?.toolCount ?? 0 : 0,
        ...(server.enabled && previous?.message !== undefined ? { message: previous.message } : {}),
        updatedAt: Date.now(),
      })
    }
    this.rows.clear()
    for (const [name, row] of next) this.rows.set(name, row)
    this.bump()
  }

  setPhase(server: McpServerSettings, phase: McpRuntimePhase, message?: string): void {
    const current = this.rows.get(server.serverName)
    if (current === undefined) return
    this.rows.set(server.serverName, {
      ...current,
      phase,
      toolCount: phase === 'disabled' || phase === 'activation-failed' ? 0 : current.toolCount,
      ...(message === undefined ? { message: undefined } : { message }),
      updatedAt: Date.now(),
    })
    this.bump()
  }

  markStopped(serverName: string): void {
    const current = this.rows.get(serverName)
    if (current === undefined) return
    this.rows.set(serverName, {
      ...current,
      phase: current.enabled ? 'configured' : 'disabled',
      toolCount: 0,
      message: undefined,
      updatedAt: Date.now(),
    })
    this.bump()
  }

  refreshTools(): void {
    const names = this.ctx.tools.schemas().map(schema => schema.name)
    let changed = false
    for (const [serverName, current] of this.rows) {
      if (!current.enabled || current.phase === 'starting' || current.phase === 'restarting' || current.phase === 'activation-failed') continue
      const prefix = `mcp__${serverName}__`
      const toolCount = names.filter(name => name.startsWith(prefix)).length
      const phase: McpRuntimePhase = toolCount > 0 ? 'tools-available' : 'active'
      if (toolCount === current.toolCount && phase === current.phase) continue
      this.rows.set(serverName, { ...current, toolCount, phase, updatedAt: Date.now() })
      changed = true
    }
    if (changed) this.bump()
  }

  snapshot(): McpRuntimeSnapshot {
    return {
      revision: this.revision,
      servers: [...this.rows.values()].map(row => ({ ...row })),
    }
  }

  private bump(): void {
    this.revision += 1
  }
}

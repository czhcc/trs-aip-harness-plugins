/** Host settings registration and dynamic MCP client lifecycle coordinator. */

import type { Context, Fiber, Volatile } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials/types'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import type {} from '@deepseek-ai/dsh-settings'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_RECONNECT,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  MCP_SETTINGS_NAMESPACE,
  validateMcpSettings,
  type McpServerSettings,
  type McpSettings,
} from './model.js'
import { MCP_STATUS_NAMESPACE, MCP_STATUS_REMOTE, MCP_STATUS_SERVICE } from './status-remote.js'
import { McpStatusDirectory, type McpRuntimeSnapshot } from './status.js'

export * from './model.js'
export * from './status.js'
export { MCP_STATUS_REMOTE } from './status-remote.js'

const ReconnectSchema = z.object({
  enabled: z.boolean().default(DEFAULT_RECONNECT.enabled),
  initialDelayMs: z.number().step(1).min(1).max(2_147_483_647).default(DEFAULT_RECONNECT.initialDelayMs),
  maxDelayMs: z.number().step(1).min(1).max(2_147_483_647).default(DEFAULT_RECONNECT.maxDelayMs),
  maxAttempts: z.number().step(1).min(1).max(2_147_483_647).default(DEFAULT_RECONNECT.maxAttempts),
})

const CommonSchema = {
  id: z.string().required(),
  enabled: z.boolean().default(true),
  serverName: z.string().required(),
  toolCallTimeoutMs: z.number().step(1).min(1).max(2_147_483_647).default(DEFAULT_TOOL_CALL_TIMEOUT_MS),
  failOnStartupError: z.boolean().default(false),
  reconnect: ReconnectSchema,
}

const ServerSchema = z.union([
  z.object({
    ...CommonSchema,
    transport: z.const('stdio'),
    command: z.string().required(),
    args: z.array(String).default([]),
    cwd: z.string().default(''),
    envCredentialRefs: z.dict(String).default({}),
    envLiterals: z.dict(String).default({}),
  }),
  z.object({
    ...CommonSchema,
    transport: z.const('streamable-http'),
    url: z.string().required(),
    headerCredentialRefs: z.dict(String).default({}),
    headerLiterals: z.dict(String).default({}),
  }),
])

/** Durable settings schema; defaults make an absent namespace an empty server list. */
export const McpSettingsSchema: z<McpSettings> = z.object({
  servers: z.array(ServerSchema).default([]),
}) as unknown as z<McpSettings>

/** DSH projects editable fields from the owning plugin's volatile Config. */
export interface Config {
  servers: Volatile<McpServerSettings[]>
}
export const Config = z.object({
  servers: z.array(ServerSchema).default([]).volatile(),
}) as unknown as z<McpSettings, Config>

// Keep the form schema serializable while enforcing domain constraints at
// the Host standard-schema boundary, before any profile write is accepted.
const configValidator = Config['~standard']
Object.defineProperty(Config, '~standard', { value: {
  ...configValidator,
  validate(value: unknown) {
    const result = configValidator.validate(value)
    if ('then' in result || result.issues) return result
    const errors = validateMcpSettings({ servers: structuredClone((result.value as Config).servers.get()) as McpServerSettings[] })
    return errors.length > 0 ? { issues: errors.map(message => ({ message })) } : result
  },
} })

interface ActiveServer {
  fiber: Fiber
  fingerprint: string
  credentialRefs: ReadonlySet<string>
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, canonical(entry)]))
}

function fingerprint(server: McpServerSettings): string {
  return JSON.stringify(canonical(server))
}

function referencedCredentials(server: McpServerSettings): ReadonlySet<string> {
  const refs = server.transport === 'stdio' ? server.envCredentialRefs : server.headerCredentialRefs
  return new Set(Object.values(refs))
}

/** Serial diff coordinator. A failed server is contained and never rolls back another server. */
export class McpCoordinator {
  private readonly active = new Map<string, ActiveServer>()
  private tail: Promise<void> = Promise.resolve()
  private desired: McpSettings = { servers: [] }
  private disposed = false

  constructor(
    private readonly ctx: Context,
    private readonly status: McpStatusDirectory,
  ) {}

  update(next: McpSettings): Promise<void> {
    this.desired = next
    this.status.configure(next)
    return this.enqueue(() => this.reconcile(next, new Set()))
  }

  restartCredential(ref: string): Promise<void> {
    const next = this.desired
    return this.enqueue(() => this.reconcile(next, new Set([ref])))
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await this.tail
    for (const [serverName, entry] of [...this.active]) {
      await this.stop(serverName, entry)
    }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const run = this.tail.then(async () => {
      if (!this.disposed) await operation()
    })
    this.tail = run.catch((error: unknown) => {
      this.ctx.logger.error(`mcp-settings: reconcile failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    return run
  }

  private async reconcile(next: McpSettings, refreshedRefs: ReadonlySet<string>): Promise<void> {
    const desired = new Map(next.servers.filter(server => server.enabled).map(server => [server.serverName, server]))

    for (const [serverName, entry] of [...this.active]) {
      const server = desired.get(serverName)
      const changed = server === undefined || entry.fingerprint !== fingerprint(server)
      const credentialChanged = [...refreshedRefs].some(ref => entry.credentialRefs.has(ref))
      if (changed || credentialChanged) await this.stop(serverName, entry, server !== undefined)
    }

    for (const server of desired.values()) {
      if (this.active.has(server.serverName)) continue
      await this.start(server)
    }
  }

  private async stop(serverName: string, entry: ActiveServer, restarting = false): Promise<void> {
    const configured = this.desired.servers.find(server => server.serverName === serverName)
    if (configured !== undefined) this.status.setPhase(configured, restarting ? 'restarting' : 'stopping')
    this.active.delete(serverName)
    try {
      await entry.fiber.dispose()
      this.ctx.logger.info(`mcp-settings(${serverName}): stopped`)
    } catch (error) {
      this.ctx.logger.warn(`mcp-settings(${serverName}): cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!restarting) this.status.markStopped(serverName)
  }

  private async start(server: McpServerSettings): Promise<void> {
    const secrets: string[] = []
    let fiber: Fiber | undefined
    this.status.setPhase(server, 'starting')
    try {
      const config = await this.resolveConfig(server, secrets)
      fiber = this.ctx.plugin(McpClient, config)
      await fiber
      this.active.set(server.serverName, {
        fiber,
        fingerprint: fingerprint(server),
        credentialRefs: referencedCredentials(server),
      })
      this.ctx.logger.info(`mcp-settings(${server.serverName}): activated`)
      this.status.setPhase(server, 'active')
      this.status.refreshTools()
    } catch (error) {
      if (fiber !== undefined) await fiber.dispose().catch(() => {})
      let message = error instanceof Error ? error.message : String(error)
      for (const secret of secrets) {
        if (secret !== '') message = message.replaceAll(secret, '[REDACTED]')
      }
      this.status.setPhase(server, 'activation-failed', message)
      this.ctx.logger.warn(`mcp-settings(${server.serverName}): activation failed: ${message}`)
    }
  }

  private async resolveConfig(server: McpServerSettings, secrets: string[]): Promise<McpClientConfig> {
    const resolved: Record<string, string> = {}
    const refs = server.transport === 'stdio' ? server.envCredentialRefs : server.headerCredentialRefs
    for (const [target, ref] of Object.entries(refs)) {
      const credential = await this.ctx.credentials.resolve(credentialRef(ref))
      if (credential === undefined) throw new Error(`credential reference "${ref}" is not configured`)
      secrets.push(credential.value)
      resolved[target] = credential.value
    }
    const common = {
      serverName: server.serverName,
      toolCallTimeoutMs: server.toolCallTimeoutMs,
      failOnStartupError: server.failOnStartupError,
      reconnect: server.reconnect,
    }
    return server.transport === 'stdio'
      ? {
          ...common,
          transport: 'stdio',
          command: server.command,
          args: server.args,
          cwd: server.cwd,
          env: { ...server.envLiterals, ...resolved },
        }
      : {
          ...common,
          transport: 'streamable-http',
          url: server.url,
          headers: { ...server.headerLiterals, ...resolved },
        }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    trsAipMcpStatusController: McpStatusController
  }
}

/** Read-only Remote owner for coordinator/tool-discovery status. */
export class McpStatusController extends TypertRemoteService {
  constructor(ctx: Context, private readonly directory: McpStatusDirectory) {
    super(ctx, MCP_STATUS_SERVICE, { namespace: MCP_STATUS_NAMESPACE })
  }

  @Remote
  snapshot(): McpRuntimeSnapshot {
    return this.directory.snapshot()
  }
}

/** Register settings and mount the coordinator only once Settings, Credentials and Tools exist. */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['settings', 'credentials', 'tools'], async (runtimeCtx) => {
    const unconfigure = runtimeCtx.settings.configure({ auto: false }, ctx.fiber)
    const status = new McpStatusDirectory(runtimeCtx)
    new McpStatusController(runtimeCtx, status)
    const coordinator = new McpCoordinator(runtimeCtx, status)
    const update = () => coordinator.update({ servers: structuredClone(config.servers.get()) as McpServerSettings[] })
    const unwatch = runtimeCtx.on('settings/document-updated', ns => {
      if (ns === MCP_SETTINGS_NAMESPACE) void update().catch(error => runtimeCtx.logger.error(error))
    })
    const offCredential = runtimeCtx.on('credentials/reference-updated', ref => coordinator.restartCredential(ref))
    const offTools = runtimeCtx.on('tools/change', () => { status.refreshTools() })
    await update()
    return async () => {
      unwatch()
      unconfigure()
      offCredential()
      offTools()
      await coordinator.dispose()
    }
  })
}

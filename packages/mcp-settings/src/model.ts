/** Durable MCP settings shared by the Host schema owner and browser editor. */

// New DSH forms address the owning Cordis entry id.
export const MCP_SETTINGS_NAMESPACE = 'trs-aip-mcp-settings'
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000
export const DEFAULT_RECONNECT = Object.freeze({
  enabled: true,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  maxAttempts: 10,
})

export interface McpReconnectSettings {
  enabled: boolean
  initialDelayMs: number
  maxDelayMs: number
  maxAttempts: number
}

interface McpServerBase {
  id: string
  enabled: boolean
  serverName: string
  toolCallTimeoutMs: number
  failOnStartupError: boolean
  reconnect: McpReconnectSettings
}

export interface McpStdioServer extends McpServerBase {
  transport: 'stdio'
  command: string
  args: string[]
  cwd: string
  envCredentialRefs: Record<string, string>
  envLiterals: Record<string, string>
}

export interface McpHttpServer extends McpServerBase {
  transport: 'streamable-http'
  url: string
  headerCredentialRefs: Record<string, string>
  headerLiterals: Record<string, string>
}

export type McpServerSettings = McpStdioServer | McpHttpServer

export interface McpSettings {
  servers: McpServerSettings[]
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const SECRET_ENV_PATTERN = /(TOKEN|PASSWORD|PASSWD|SECRET|API_?KEY|PRIVATE_?KEY|CREDENTIAL)/i
const SECRET_HEADER_PATTERN = /(authorization|cookie|token|secret|api[-_]?key|credential)/i
const MAX_SERVERS = 32
const MAX_ARGS = 128
const MAX_MAP_ENTRIES = 64
const MAX_TEXT_LENGTH = 4_096
const MAX_TIMER_DELAY_MS = 2_147_483_647

function validateMap(
  errors: string[],
  label: string,
  value: Record<string, string>,
  keyPattern: RegExp,
  credentialValues: boolean,
): void {
  const entries = Object.entries(value)
  if (entries.length > MAX_MAP_ENTRIES) errors.push(`${label}最多允许 ${MAX_MAP_ENTRIES} 项`)
  for (const [key, entry] of entries) {
    if (!keyPattern.test(key)) errors.push(`${label}包含非法名称“${key}”`)
    if (key.length > 128 || entry.length > MAX_TEXT_LENGTH) errors.push(`${label}中的名称或值过长`)
    if (credentialValues && !CREDENTIAL_REF_PATTERN.test(entry)) {
      errors.push(`${label}“${key}”的凭据引用必须是环境变量式名称`)
    }
  }
}

/** Validate cross-field, uniqueness and security constraints Schemastery cannot express. */
export function validateMcpSettings(value: McpSettings): string[] {
  const errors: string[] = []
  if (value.servers.length > MAX_SERVERS) errors.push(`MCP 客户端最多允许 ${MAX_SERVERS} 个`)
  const ids = new Set<string>()
  const names = new Set<string>()

  for (const [index, server] of value.servers.entries()) {
    const label = `第 ${index + 1} 个客户端`
    if (!ID_PATTERN.test(server.id)) errors.push(`${label}的 ID 必须匹配 [A-Za-z0-9_-]{1,64}`)
    if (ids.has(server.id)) errors.push(`客户端 ID“${server.id}”重复`)
    ids.add(server.id)
    if (!SERVER_NAME_PATTERN.test(server.serverName)) {
      errors.push(`${label}的 serverName 必须匹配 [A-Za-z0-9_-]{1,32}`)
    }
    if (names.has(server.serverName)) errors.push(`serverName“${server.serverName}”重复`)
    names.add(server.serverName)

    if (!Number.isInteger(server.toolCallTimeoutMs)
      || server.toolCallTimeoutMs < 1
      || server.toolCallTimeoutMs > MAX_TIMER_DELAY_MS) {
      errors.push(`${label}的工具调用超时必须是合法正整数`)
    }
    const reconnect = server.reconnect
    for (const [field, number] of [
      ['initialDelayMs', reconnect.initialDelayMs],
      ['maxDelayMs', reconnect.maxDelayMs],
      ['maxAttempts', reconnect.maxAttempts],
    ] as const) {
      if (!Number.isInteger(number) || number < 1 || number > MAX_TIMER_DELAY_MS) {
        errors.push(`${label}的 reconnect.${field} 必须是合法正整数`)
      }
    }
    if (reconnect.initialDelayMs > reconnect.maxDelayMs) {
      errors.push(`${label}的重连初始延迟不能大于最大延迟`)
    }

    if (server.transport === 'stdio') {
      if (server.command.trim() === '') errors.push(`${label}的启动命令不能为空`)
      if (server.command.length > MAX_TEXT_LENGTH || server.cwd.length > MAX_TEXT_LENGTH) {
        errors.push(`${label}的命令或工作目录过长`)
      }
      if (server.args.length > MAX_ARGS || server.args.some(arg => arg.length > MAX_TEXT_LENGTH)) {
        errors.push(`${label}的参数数量或长度超出限制`)
      }
      validateMap(errors, `${label}的环境变量凭据`, server.envCredentialRefs, ENV_NAME_PATTERN, true)
      validateMap(errors, `${label}的普通环境变量`, server.envLiterals, ENV_NAME_PATTERN, false)
      for (const key of Object.keys(server.envLiterals)) {
        if (SECRET_ENV_PATTERN.test(key)) errors.push(`${label}的敏感环境变量“${key}”必须使用凭据引用`)
        if (Object.hasOwn(server.envCredentialRefs, key)) errors.push(`${label}的环境变量“${key}”配置重复`)
      }
    } else {
      let parsed: URL | undefined
      try { parsed = new URL(server.url) } catch { /* reported below */ }
      if (parsed === undefined || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        errors.push(`${label}的 URL 必须是有效的 http 或 https 地址`)
      }
      if (server.url.length > MAX_TEXT_LENGTH) errors.push(`${label}的 URL 过长`)
      validateMap(errors, `${label}的请求头凭据`, server.headerCredentialRefs, HEADER_NAME_PATTERN, true)
      validateMap(errors, `${label}的普通请求头`, server.headerLiterals, HEADER_NAME_PATTERN, false)
      for (const key of Object.keys(server.headerLiterals)) {
        if (SECRET_HEADER_PATTERN.test(key)) errors.push(`${label}的敏感请求头“${key}”必须使用凭据引用`)
        if (Object.hasOwn(server.headerCredentialRefs, key)) errors.push(`${label}的请求头“${key}”配置重复`)
      }
    }
  }
  return errors
}

/** A complete blank stdio record for the browser's Add action. */
export function createDefaultStdioServer(id: string, serverName: string): McpStdioServer {
  return {
    id,
    enabled: false,
    serverName,
    transport: 'stdio',
    command: '',
    args: [],
    cwd: '',
    envCredentialRefs: {},
    envLiterals: {},
    toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
    failOnStartupError: false,
    reconnect: { ...DEFAULT_RECONNECT },
  }
}

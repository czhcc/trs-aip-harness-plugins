import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, CSSProperties, ReactNode } from 'react'
import type { CredentialInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  ConfigForm,
  SettingsSectionOwnerProps,
} from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  createDefaultStdioServer,
  validateMcpSettings,
  type McpHttpServer,
  type McpServerSettings,
  type McpSettings,
  type McpStdioServer,
} from '../model.js'
import type { McpRuntimeSnapshot, McpServerRuntimeStatus } from '../status.js'

export interface McpSettingsOperations {
  loadStatus(): Promise<McpRuntimeSnapshot | undefined>
  describeCredentials(refs: string[]): Promise<Record<string, CredentialInfo>>
  setCredential(ref: string, value: string): Promise<string | undefined>
  unsetCredential(ref: string): Promise<string | undefined>
}

interface McpSettingsSectionProps extends SettingsSectionOwnerProps {
  scope: ConfigForm<McpSettings>
  operations: McpSettingsOperations
}

const styles: Record<string, CSSProperties> = {
  page: { display: 'grid', gap: 18, padding: '4px 2px 28px', color: 'var(--dsw-alias-label-primary)' },
  heading: { margin: 0, fontSize: 22, lineHeight: 1.3 },
  intro: { margin: 0, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 },
  toolbar: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  button: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '7px 12px', background: 'var(--dsw-alias-bg-layer-1)', color: 'inherit', cursor: 'pointer' },
  primaryButton: { border: 0, borderRadius: 8, padding: '8px 14px', background: 'var(--dsw-alias-brand-primary)', color: '#fff', cursor: 'pointer' },
  dangerButton: { border: '1px solid #d33a4a66', borderRadius: 8, padding: '7px 12px', background: 'transparent', color: '#d33a4a', cursor: 'pointer' },
  badge: { display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '3px 8px', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-secondary)', fontSize: 12, fontWeight: 500 },
  card: { display: 'grid', gap: 14, border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12, padding: 16, background: 'var(--dsw-alias-bg-layer-1)' },
  cardHead: { display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { display: 'flex', gap: 10, alignItems: 'center', fontWeight: 650 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 },
  field: { display: 'grid', gap: 6, minWidth: 0 },
  fieldWide: { display: 'grid', gap: 6, gridColumn: '1 / -1' },
  label: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' },
  input: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '8px 10px', background: 'var(--dsw-alias-bg-base)', color: 'inherit', font: 'inherit' },
  textarea: { width: '100%', minHeight: 82, boxSizing: 'border-box', resize: 'vertical', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '8px 10px', background: 'var(--dsw-alias-bg-base)', color: 'inherit', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 13 },
  advanced: { borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 12 },
  checks: { display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' },
  check: { display: 'inline-flex', gap: 7, alignItems: 'center', fontSize: 14 },
  warning: { margin: 0, borderRadius: 8, padding: '10px 12px', background: '#c7840018', color: 'var(--dsw-alias-label-primary)', lineHeight: 1.5 },
  error: { margin: 0, borderRadius: 8, padding: '10px 12px', background: '#d33a4a14', color: '#d33a4a', lineHeight: 1.5 },
  muted: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: 13 },
  empty: { border: '1px dashed var(--dsw-alias-border-l1)', borderRadius: 12, padding: 28, textAlign: 'center', color: 'var(--dsw-alias-label-secondary)' },
  credentialRow: { display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) minmax(180px, 1.4fr) auto', gap: 10, alignItems: 'end' },
}

function runtimeLabel(status: McpServerRuntimeStatus | undefined): string {
  if (status === undefined) return '状态待同步'
  switch (status.phase) {
    case 'disabled': return '已禁用'
    case 'configured': return '等待启动'
    case 'starting': return '正在启动实例'
    case 'active': return '实例已激活，未发现工具'
    case 'tools-available': return `已发现 ${status.toolCount} 个工具`
    case 'restarting': return '正在重新启动实例'
    case 'stopping': return '正在停止实例'
    case 'activation-failed': return '实例激活失败'
  }
}

function credentialRefs(settings: McpSettings): string[] {
  const refs = new Set<string>()
  for (const server of settings.servers) {
    const source = server.transport === 'stdio' ? server.envCredentialRefs : server.headerCredentialRefs
    for (const ref of Object.values(source)) if (ref !== '') refs.add(ref)
  }
  return [...refs].sort()
}

function uniqueCopyName(base: string, maximumLength: number, used: ReadonlySet<string>): string {
  for (let number = 1; ; number += 1) {
    const suffix = number === 1 ? '_copy' : `_copy${number}`
    const candidate = `${base.slice(0, Math.max(1, maximumLength - suffix.length))}${suffix}`
    if (!used.has(candidate)) return candidate
  }
}

function mapToText(value: Record<string, string>): string {
  return Object.entries(value).map(([key, entry]) => `${key}=${entry}`).join('\n')
}

function textToMap(value: string): Record<string, string> {
  const entries: Array<[string, string]> = []
  for (const raw of value.split(/\r?\n/)) {
    if (raw.trim() === '') continue
    const separator = raw.indexOf('=')
    entries.push(separator < 0
      ? [raw.trim(), '']
      : [raw.slice(0, separator).trim(), raw.slice(separator + 1)])
  }
  return Object.fromEntries(entries)
}

function MapEditor(props: {
  label: string
  hint: string
  value: Record<string, string>
  disabled: boolean
  onChange: (value: Record<string, string>) => void
}): ReactNode {
  return (
    <label style={styles.fieldWide}>
      <span style={styles.label}>{props.label}</span>
      <textarea
        style={styles.textarea}
        value={mapToText(props.value)}
        disabled={props.disabled}
        placeholder={props.hint}
        spellCheck={false}
        onChange={event => { props.onChange(textToMap(event.target.value)) }}
      />
    </label>
  )
}

function transportChanged(server: McpServerSettings, transport: McpServerSettings['transport']): McpServerSettings {
  if (server.transport === transport) return server
  const common = {
    id: server.id,
    // Switching to a local process transport must never silently execute it.
    enabled: transport === 'stdio' ? false : server.enabled,
    serverName: server.serverName,
    toolCallTimeoutMs: server.toolCallTimeoutMs,
    failOnStartupError: server.failOnStartupError,
    reconnect: server.reconnect,
  }
  return transport === 'stdio'
    ? { ...common, transport, command: '', args: [], cwd: '', envCredentialRefs: {}, envLiterals: {} }
    : { ...common, transport, url: '', headerCredentialRefs: {}, headerLiterals: {} }
}

function ServerCard(props: {
  index: number
  server: McpServerSettings
  runtime: McpServerRuntimeStatus | undefined
  disabled: boolean
  update: (server: McpServerSettings) => void
  copy: () => void
  remove: () => void
}): ReactNode {
  const { server, disabled, update } = props
  const patch = (value: Partial<McpServerSettings>): void => { update({ ...server, ...value } as McpServerSettings) }
  const patchReconnect = (value: Partial<McpServerSettings['reconnect']>): void => {
    patch({ reconnect: { ...server.reconnect, ...value } } as Partial<McpServerSettings>)
  }
  return (
    <article style={styles.card}>
      <header style={styles.cardHead}>
        <span style={styles.cardTitle}>
          <input
            type="checkbox"
            checked={server.enabled}
            disabled={disabled}
            aria-label={`启用 ${server.serverName || `客户端 ${props.index + 1}`}`}
            onChange={event => {
              const enabled = event.target.checked
              if (enabled && server.transport === 'stdio' && !window.confirm(
                `启用 stdio MCP“${server.serverName || server.id}”将允许宿主在 Agent 沙箱之外执行“${server.command || '尚未填写的命令'}”及其参数。确认启用吗？`,
              )) return
              patch({ enabled })
            }}
          />
          {server.serverName || `客户端 ${props.index + 1}`}
          <span style={styles.badge} title={props.runtime?.message}>{runtimeLabel(props.runtime)}</span>
        </span>
        <span style={styles.toolbar}>
          <button type="button" style={styles.button} disabled={disabled} onClick={props.copy}>复制</button>
          <button type="button" style={styles.dangerButton} disabled={disabled} onClick={props.remove}>删除</button>
        </span>
      </header>

      {props.runtime?.message === undefined ? null : <p style={styles.error} role="alert">{props.runtime.message}</p>}

      <div style={styles.grid}>
        <label style={styles.field}>
          <span style={styles.label}>配置 ID</span>
          <input style={styles.input} value={server.id} disabled={disabled} spellCheck={false} onChange={event => { patch({ id: event.target.value }) }} />
        </label>
        <label style={styles.field}>
          <span style={styles.label}>serverName（工具命名空间）</span>
          <input style={styles.input} value={server.serverName} disabled={disabled} spellCheck={false} onChange={event => { patch({ serverName: event.target.value }) }} />
        </label>
        <label style={styles.field}>
          <span style={styles.label}>传输类型</span>
          <select
            style={styles.input}
            value={server.transport}
            disabled={disabled}
            onChange={event => { update(transportChanged(server, event.target.value as McpServerSettings['transport'])) }}
          >
            <option value="stdio">stdio</option>
            <option value="streamable-http">streamable-http</option>
          </select>
        </label>
        <label style={styles.field}>
          <span style={styles.label}>工具调用超时（毫秒）</span>
          <input type="number" min={1} step={1} style={styles.input} value={server.toolCallTimeoutMs} disabled={disabled} onChange={event => { patch({ toolCallTimeoutMs: Number(event.target.value) }) }} />
        </label>

        {server.transport === 'stdio'
          ? (
            <>
              <label style={styles.field}>
                <span style={styles.label}>启动命令</span>
                <input style={styles.input} value={server.command} disabled={disabled} spellCheck={false} placeholder="npx" onChange={event => { patch({ command: event.target.value } as Partial<McpStdioServer>) }} />
              </label>
              <label style={styles.field}>
                <span style={styles.label}>工作目录（可选）</span>
                <input style={styles.input} value={server.cwd} disabled={disabled} spellCheck={false} onChange={event => { patch({ cwd: event.target.value } as Partial<McpStdioServer>) }} />
              </label>
              <label style={styles.fieldWide}>
                <span style={styles.label}>参数（每行一项，原样传递）</span>
                <textarea style={styles.textarea} value={server.args.join('\n')} disabled={disabled} spellCheck={false} placeholder={'-y\n@modelcontextprotocol/server-example'} onChange={event => { patch({ args: event.target.value.split(/\r?\n/).filter(line => line !== '') } as Partial<McpStdioServer>) }} />
              </label>
              <MapEditor label="环境变量凭据引用" hint="GITHUB_TOKEN=GITHUB_TOKEN" value={server.envCredentialRefs} disabled={disabled} onChange={value => { patch({ envCredentialRefs: value } as Partial<McpStdioServer>) }} />
              <MapEditor label="非敏感环境变量" hint="LOG_LEVEL=info" value={server.envLiterals} disabled={disabled} onChange={value => { patch({ envLiterals: value } as Partial<McpStdioServer>) }} />
            </>
            )
          : (
            <>
              <label style={styles.fieldWide}>
                <span style={styles.label}>MCP URL</span>
                <input style={styles.input} value={server.url} disabled={disabled} spellCheck={false} placeholder="https://example.test/mcp" onChange={event => { patch({ url: event.target.value } as Partial<McpHttpServer>) }} />
              </label>
              <MapEditor label="请求头凭据引用" hint="Authorization=MCP_AUTHORIZATION" value={server.headerCredentialRefs} disabled={disabled} onChange={value => { patch({ headerCredentialRefs: value } as Partial<McpHttpServer>) }} />
              <MapEditor label="非敏感请求头" hint="X-Client-Name=trs-aip" value={server.headerLiterals} disabled={disabled} onChange={value => { patch({ headerLiterals: value } as Partial<McpHttpServer>) }} />
            </>
            )}
      </div>

      <details style={styles.advanced}>
        <summary>高级连接策略</summary>
        <div style={{ ...styles.grid, marginTop: 12 }}>
          <div style={{ ...styles.checks, gridColumn: '1 / -1' }}>
            <label style={styles.check}>
              <input type="checkbox" checked={server.failOnStartupError} disabled={disabled} onChange={event => { patch({ failOnStartupError: event.target.checked }) }} />
              初始连接失败时让实例激活失败
            </label>
            <label style={styles.check}>
              <input type="checkbox" checked={server.reconnect.enabled} disabled={disabled} onChange={event => { patchReconnect({ enabled: event.target.checked }) }} />
              自动重连
            </label>
          </div>
          <label style={styles.field}>
            <span style={styles.label}>初始延迟（毫秒）</span>
            <input type="number" min={1} step={1} style={styles.input} value={server.reconnect.initialDelayMs} disabled={disabled} onChange={event => { patchReconnect({ initialDelayMs: Number(event.target.value) }) }} />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>最大延迟（毫秒）</span>
            <input type="number" min={1} step={1} style={styles.input} value={server.reconnect.maxDelayMs} disabled={disabled} onChange={event => { patchReconnect({ maxDelayMs: Number(event.target.value) }) }} />
          </label>
          <label style={styles.field}>
            <span style={styles.label}>最大尝试次数</span>
            <input type="number" min={1} step={1} style={styles.input} value={server.reconnect.maxAttempts} disabled={disabled} onChange={event => { patchReconnect({ maxAttempts: Number(event.target.value) }) }} />
          </label>
        </div>
      </details>
    </article>
  )
}

/** Independent Settings section for editing the durable MCP server array. */
export function McpSettingsSection({ scope, operations }: McpSettingsSectionProps): ReactNode {
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [draft, setDraft] = useState<McpSettings>()
  const [dirty, setDirty] = useState(false)
  const [baseRevision, setBaseRevision] = useState<number>()
  const [status, setStatus] = useState('')
  const [runtime, setRuntime] = useState<McpRuntimeSnapshot>()
  const [credentialInfo, setCredentialInfo] = useState<Record<string, CredentialInfo>>({})
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>({})
  const [operationError, setOperationError] = useState('')

  useEffect(() => {
    if (snapshot.status !== 'ready' || snapshot.value === undefined || dirty) return
    setDraft(structuredClone(snapshot.value))
    setBaseRevision(snapshot.revision)
  }, [snapshot.status, snapshot.value, snapshot.revision, dirty])

  useEffect(() => {
    let active = true
    const refresh = async (): Promise<void> => {
      try {
        const next = await operations.loadStatus()
        if (active) setRuntime(next)
      } catch (error) {
        if (active) setOperationError(`读取 MCP 运行状态失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 1_500)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [operations])

  const errors = useMemo(() => draft === undefined ? [] : validateMcpSettings(draft), [draft])
  const refs = useMemo(() => draft === undefined ? [] : credentialRefs(draft), [draft])
  const refsKey = refs.join('\u0000')
  const runtimeByName = useMemo(
    () => new Map(runtime?.servers.map(server => [server.serverName, server]) ?? []),
    [runtime],
  )
  const disabled = !snapshot.writable
  const remoteChanged = dirty && baseRevision !== undefined && snapshot.revision !== baseRevision

  const refreshCredentials = useCallback(async (): Promise<void> => {
    if (refs.length === 0) {
      setCredentialInfo({})
      return
    }
    try {
      setCredentialInfo(await operations.describeCredentials(refs))
    } catch (error) {
      setOperationError(`读取凭据状态失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [operations, refsKey])

  useEffect(() => { void refreshCredentials() }, [refreshCredentials])

  const change = (next: McpSettings): void => {
    setDraft(next)
    setDirty(true)
    setStatus('有未保存的修改')
  }
  const updateServer = (index: number, server: McpServerSettings): void => {
    if (draft === undefined) return
    const servers = [...draft.servers]
    servers[index] = server
    change({ servers })
  }
  const add = (): void => {
    if (draft === undefined) return
    let number = draft.servers.length + 1
    while (draft.servers.some(server => server.serverName === `server_${number}`)) number += 1
    change({ servers: [...draft.servers, createDefaultStdioServer(`mcp_${Date.now().toString(36)}`, `server_${number}`)] })
  }
  const copyServer = (index: number): void => {
    if (draft === undefined) return
    const source = structuredClone(draft.servers[index])
    if (source === undefined) return
    source.id = uniqueCopyName(source.id, 64, new Set(draft.servers.map(server => server.id)))
    source.serverName = uniqueCopyName(source.serverName, 32, new Set(draft.servers.map(server => server.serverName)))
    source.enabled = false
    const servers = [...draft.servers]
    servers.splice(index + 1, 0, source)
    change({ servers })
    setStatus('已复制客户端；副本默认禁用')
  }
  const exportSettings = (): void => {
    if (draft === undefined) return
    const payload = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      servers: draft.servers,
    }, null, 2)
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'trs-aip-mcp-settings.json'
    anchor.click()
    URL.revokeObjectURL(url)
    setStatus('已导出配置（仅含凭据引用，不含凭据值）')
  }
  const importSettings = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (file === undefined) return
    setOperationError('')
    try {
      if (file.size > 1_048_576) throw new Error('导入文件不能超过 1 MiB')
      const raw = JSON.parse(await file.text()) as unknown
      if (typeof raw !== 'object' || raw === null || !('servers' in raw) || !Array.isArray(raw.servers)) {
        throw new Error('文件必须包含 servers 数组')
      }
      const candidate = {
        servers: structuredClone(raw.servers).map((server: unknown) => {
          if (typeof server !== 'object' || server === null) return server
          return 'transport' in server && server.transport === 'stdio'
            ? { ...server, enabled: false }
            : server
        }),
      } as McpSettings
      const importedErrors = validateMcpSettings(candidate)
      if (importedErrors.length > 0) throw new Error(importedErrors.join('；'))
      change(candidate)
      setStatus('已导入为未保存草稿；stdio 客户端已全部禁用')
    } catch (error) {
      setOperationError(`导入失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const storeCredential = async (ref: string): Promise<void> => {
    const value = credentialDrafts[ref] ?? ''
    if (value === '') {
      setOperationError(`凭据“${ref}”不能为空`)
      return
    }
    setOperationError('')
    try {
      const error = await operations.setCredential(ref, value)
      if (error !== undefined) {
        setOperationError(`保存凭据“${ref}”失败：${error}`)
        return
      }
      setCredentialDrafts(current => ({ ...current, [ref]: '' }))
      setStatus(`凭据“${ref}”已保存；值不会回显`)
      await refreshCredentials()
    } catch (error) {
      setOperationError(`保存凭据“${ref}”失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const removeCredential = async (ref: string): Promise<void> => {
    if (!window.confirm(`确认删除凭据“${ref}”吗？其他引用同名凭据的功能也会受到影响。`)) return
    setOperationError('')
    try {
      const error = await operations.unsetCredential(ref)
      if (error !== undefined) {
        setOperationError(`删除凭据“${ref}”失败：${error}`)
        return
      }
      setStatus(`凭据“${ref}”已删除`)
      await refreshCredentials()
    } catch (error) {
      setOperationError(`删除凭据“${ref}”失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const discard = (): void => {
    if (snapshot.value === undefined) return
    setDraft(structuredClone(snapshot.value))
    setBaseRevision(snapshot.revision)
    setDirty(false)
    setStatus('已放弃修改')
  }
  const save = async (): Promise<void> => {
    if (draft === undefined || baseRevision === undefined || errors.length > 0) return
    setStatus('保存中…')
    try {
      // The domain interfaces are structurally JSON-shaped; the wire alias additionally
      // requires an index signature that ordinary TypeScript interfaces do not carry.
      await scope.mutate([{ op: 'set', path: ['servers'], value: draft.servers as never }], baseRevision)
      const accepted = scope.getSnapshot()
      if (accepted.status !== 'ready' || JSON.stringify(accepted.value?.servers) !== JSON.stringify(draft.servers)) {
        throw new Error('配置已被其他页面修改，请放弃本地修改后重试')
      }
      setBaseRevision(accepted.revision)
      setDirty(false)
      setStatus('已保存；运行结果将在状态徽标中更新')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }
  const restore = async (): Promise<void> => {
    if (baseRevision === undefined) return
    setStatus('恢复中…')
    try {
      await scope.mutate([{ op: 'unset', path: ['servers'] }], baseRevision)
      const accepted = scope.getSnapshot()
      if (accepted.status !== 'ready' || accepted.value === undefined) throw new Error('恢复默认值失败')
      setDraft(structuredClone(accepted.value))
      setBaseRevision(accepted.revision)
      setDirty(false)
      setStatus('已恢复默认值')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    }
  }

  if (snapshot.status === 'unavailable') return <p style={styles.warning}>当前页面不是宿主 loopback 页面，MCP 配置只读且不会持久化。</p>
  if (snapshot.status === 'loading' || draft === undefined) return <p style={styles.muted}>正在加载 MCP 配置…</p>

  return (
    <section style={styles.page}>
      <div>
        <h2 style={styles.heading}>MCP 客户端</h2>
        <p style={styles.intro}>管理宿主全局 MCP 工具。状态表示协调器实例生命周期和宿主已注册的工具数，不代表底层 MCP 协议连接状态。</p>
      </div>
      {!snapshot.writable ? <p style={styles.warning}>当前设置提供者不可写，所有编辑操作已禁用。</p> : null}
      {draft.servers.some(server => server.enabled && server.transport === 'stdio')
        ? <p style={styles.warning}>安全提示：启用 stdio MCP 会授权宿主在 Agent 沙箱之外执行所填写的程序和参数。</p>
        : null}
      {remoteChanged ? <p style={styles.error} role="alert">宿主配置已在别处更新。当前草稿仍保留，但保存会因 revision 冲突被拒绝。</p> : null}
      {errors.length > 0
        ? <div style={styles.error} role="alert">{errors.map(error => <div key={error}>{error}</div>)}</div>
        : null}
      {operationError === '' ? null : <p style={styles.error} role="alert">{operationError}</p>}
      <div style={styles.toolbar}>
        <button type="button" style={styles.primaryButton} disabled={disabled} onClick={add}>添加客户端</button>
        <button type="button" style={styles.primaryButton} disabled={disabled || !dirty || errors.length > 0} onClick={() => { void save() }}>保存</button>
        <button type="button" style={styles.button} disabled={!dirty} onClick={discard}>放弃修改</button>
        <button type="button" style={styles.button} disabled={disabled} onClick={() => { void restore() }}>恢复默认</button>
        <button type="button" style={styles.button} onClick={exportSettings}>导出 JSON</button>
        <label style={{ ...styles.button, cursor: disabled ? 'default' : 'pointer' }}>
          导入 JSON
          <input type="file" accept="application/json,.json" disabled={disabled} hidden onChange={event => { void importSettings(event) }} />
        </label>
        {status === '' ? null : <span style={styles.muted} role="status">{status}</span>}
      </div>

      <article style={styles.card}>
        <header style={styles.cardHead}>
          <strong>引用凭据</strong>
          <span style={styles.muted}>凭据值只写入宿主凭据存储，页面不会读取或导出。</span>
        </header>
        {refs.length === 0
          ? <p style={styles.muted}>当前草稿未引用凭据。</p>
          : refs.map((ref) => {
              const info = credentialInfo[ref]
              const writable = snapshot.writable && info?.writable === true
              return (
                <div key={ref} style={styles.credentialRow}>
                  <span style={styles.field}>
                    <code>{ref}</code>
                    <span style={styles.muted}>
                      {info === undefined
                        ? '状态待同步'
                        : info.configured
                          ? `已配置${info.source === undefined ? '' : `（${info.source}）`}`
                          : '未配置'}
                    </span>
                  </span>
                  <label style={styles.field}>
                    <span style={styles.label}>新凭据值（不会回显）</span>
                    <input
                      type="password"
                      style={styles.input}
                      value={credentialDrafts[ref] ?? ''}
                      disabled={!writable}
                      autoComplete="new-password"
                      onChange={event => { setCredentialDrafts(current => ({ ...current, [ref]: event.target.value })) }}
                    />
                  </label>
                  <span style={styles.toolbar}>
                    <button type="button" style={styles.button} disabled={!writable || (credentialDrafts[ref] ?? '') === ''} onClick={() => { void storeCredential(ref) }}>保存凭据</button>
                    <button type="button" style={styles.dangerButton} disabled={!writable || info?.configured !== true} onClick={() => { void removeCredential(ref) }}>删除</button>
                  </span>
                </div>
              )
            })}
      </article>

      {draft.servers.length === 0
        ? <div style={styles.empty}>尚未配置 MCP 客户端。</div>
        : draft.servers.map((server, index) => (
          <ServerCard
            key={`${String(index)}:${server.id}`}
            index={index}
            server={server}
            runtime={runtimeByName.get(server.serverName)}
            disabled={disabled}
            update={next => { updateServer(index, next) }}
            copy={() => { copyServer(index) }}
            remove={() => { change({ servers: draft.servers.filter((_, candidate) => candidate !== index) }) }}
          />
        ))}
    </section>
  )
}

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  SettingsScope,
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

interface McpSettingsSectionProps extends SettingsSectionOwnerProps {
  scope: SettingsScope<McpSettings>
}

const styles: Record<string, CSSProperties> = {
  page: { display: 'grid', gap: 18, padding: '4px 2px 28px', color: 'var(--dsw-alias-label-primary)' },
  heading: { margin: 0, fontSize: 22, lineHeight: 1.3 },
  intro: { margin: 0, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.6 },
  toolbar: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  button: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, padding: '7px 12px', background: 'var(--dsw-alias-bg-layer-1)', color: 'inherit', cursor: 'pointer' },
  primaryButton: { border: 0, borderRadius: 8, padding: '8px 14px', background: 'var(--dsw-alias-brand-primary)', color: '#fff', cursor: 'pointer' },
  dangerButton: { border: '1px solid #d33a4a66', borderRadius: 8, padding: '7px 12px', background: 'transparent', color: '#d33a4a', cursor: 'pointer' },
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
    enabled: server.enabled,
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
  disabled: boolean
  update: (server: McpServerSettings) => void
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
            onChange={event => { patch({ enabled: event.target.checked }) }}
          />
          {server.serverName || `客户端 ${props.index + 1}`}
        </span>
        <button type="button" style={styles.dangerButton} disabled={disabled} onClick={props.remove}>删除</button>
      </header>

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
export function McpSettingsSection({ scope }: McpSettingsSectionProps): ReactNode {
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const [draft, setDraft] = useState<McpSettings>()
  const [dirty, setDirty] = useState(false)
  const [baseRevision, setBaseRevision] = useState<number>()
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (snapshot.status !== 'ready' || snapshot.value === undefined || dirty) return
    setDraft(structuredClone(snapshot.value))
    setBaseRevision(snapshot.revision)
  }, [snapshot.status, snapshot.value, snapshot.revision, dirty])

  const errors = useMemo(() => draft === undefined ? [] : validateMcpSettings(draft), [draft])
  const disabled = !snapshot.writable
  const remoteChanged = dirty && baseRevision !== undefined && snapshot.revision !== baseRevision

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
      setStatus('已保存；连接结果请查看宿主日志')
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
        <p style={styles.intro}>管理宿主全局 MCP 工具。保存表示配置已持久化，连接与工具发现结果请查看宿主日志。</p>
      </div>
      {!snapshot.writable ? <p style={styles.warning}>当前设置提供者不可写，所有编辑操作已禁用。</p> : null}
      {draft.servers.some(server => server.enabled && server.transport === 'stdio')
        ? <p style={styles.warning}>安全提示：启用 stdio MCP 会授权宿主在 Agent 沙箱之外执行所填写的程序和参数。</p>
        : null}
      {remoteChanged ? <p style={styles.error} role="alert">宿主配置已在别处更新。当前草稿仍保留，但保存会因 revision 冲突被拒绝。</p> : null}
      {errors.length > 0
        ? <div style={styles.error} role="alert">{errors.map(error => <div key={error}>{error}</div>)}</div>
        : null}
      <div style={styles.toolbar}>
        <button type="button" style={styles.primaryButton} disabled={disabled} onClick={add}>添加客户端</button>
        <button type="button" style={styles.primaryButton} disabled={disabled || !dirty || errors.length > 0} onClick={() => { void save() }}>保存</button>
        <button type="button" style={styles.button} disabled={!dirty} onClick={discard}>放弃修改</button>
        <button type="button" style={styles.button} disabled={disabled} onClick={() => { void restore() }}>恢复默认</button>
        {status === '' ? null : <span style={styles.muted} role="status">{status}</span>}
      </div>
      {draft.servers.length === 0
        ? <div style={styles.empty}>尚未配置 MCP 客户端。</div>
        : draft.servers.map((server, index) => (
          <ServerCard
            key={`${String(index)}:${server.id}`}
            index={index}
            server={server}
            disabled={disabled}
            update={next => { updateServer(index, next) }}
            remove={() => { change({ servers: draft.servers.filter((_, candidate) => candidate !== index) }) }}
          />
        ))}
    </section>
  )
}

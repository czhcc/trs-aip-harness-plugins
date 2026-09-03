import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { THEME_MANAGER_ROUTE, type ThemeCatalogEntry, type ThemeTarget } from '../contract.js'

export interface ThemeManagerProps {
  active(themes: ThemeCatalogEntry[]): ThemeTarget | 'unknown'
}

const STYLE = `
.trs-theme-manager{display:grid;gap:14px;color:var(--dsw-alias-label-primary)}
.trs-theme-manager__header{display:grid;gap:6px}.trs-theme-manager__header h2,.trs-theme-manager__header p{margin:0}
.trs-theme-manager__header p,.trs-theme-manager__hint{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.6}
.trs-theme-manager__card{display:grid;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.trs-theme-manager__grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:9px}
.trs-theme-manager__choice{display:grid;justify-items:start;gap:4px;min-height:70px;padding:12px;color:var(--dsw-alias-label-primary);text-align:left;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);cursor:pointer}
.trs-theme-manager__choice:hover:not(:disabled){border-color:var(--theme-accent,var(--dsw-alias-brand-primary));transform:translateY(-1px)}
.trs-theme-manager__choice[data-active=true]{border-color:var(--theme-accent,var(--dsw-alias-brand-primary));box-shadow:inset 4px 0 var(--theme-accent,var(--dsw-alias-brand-primary))}
.trs-theme-manager__choice:disabled{opacity:.72;cursor:default}.trs-theme-manager__choice small{color:var(--dsw-alias-label-tertiary);line-height:1.45}
.trs-theme-manager__state{margin-top:auto}.trs-theme-manager__error{margin:0;color:var(--dsw-alias-state-danger,#c43d3d);font-size:12px}
@media(max-width:720px){.trs-theme-manager__grid{grid-template-columns:1fr}}
`

async function fetchThemes(): Promise<ThemeCatalogEntry[]> {
  const response = await fetch(THEME_MANAGER_ROUTE, { credentials: 'same-origin' })
  const result = await response.json() as { ok?: boolean, themes?: ThemeCatalogEntry[], error?: string }
  if (!response.ok || result.ok !== true || !Array.isArray(result.themes)) {
    throw new Error(result.error ?? `HTTP ${response.status}`)
  }
  return result.themes
}

async function requestSwitch(target: ThemeTarget): Promise<void> {
  const response = await fetch(THEME_MANAGER_ROUTE, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target }),
  })
  const result = await response.json() as { ok?: boolean, error?: string }
  if (!response.ok || result.ok !== true) throw new Error(result.error ?? `HTTP ${response.status}`)
  window.setTimeout(() => window.location.reload(), 1200)
}

export function ThemeManager({ active }: ThemeManagerProps) {
  const [themes, setThemes] = useState<ThemeCatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [switching, setSwitching] = useState<ThemeTarget | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useMemo(() => active(themes), [active, themes])

  useEffect(() => {
    let live = true
    void fetchThemes().then((catalog) => {
      if (live) setThemes(catalog)
    }).catch((reason: unknown) => {
      if (live) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (live) setLoading(false)
    })
    return () => { live = false }
  }, [])

  const choose = (target: ThemeTarget): void => {
    setSwitching(target)
    setError(null)
    void requestSwitch(target).catch((reason: unknown) => {
      setSwitching(null)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const choices = [{
    id: 'official',
    name: 'DeepSeek Harness 原版',
    tagline: '关闭所有扩展主题并恢复原版界面风格，保留当前品牌与 Logo 插件',
  }, ...themes]

  return (
    <div className="trs-theme-manager">
      <style>{STYLE}</style>
      <header className="trs-theme-manager__header">
        <h2>风格主题</h2>
        <p>一次启用一个已安装主题，也可以随时换回 DeepSeek Harness 原版。</p>
      </header>
      <section className="trs-theme-manager__card">
        <div className="trs-theme-manager__grid">
          {choices.map((theme) => {
            const selected = current === theme.id
            const pending = switching === theme.id
            return (
              <button
                key={theme.id}
                type="button"
                className="trs-theme-manager__choice"
                data-active={selected}
                style={{ '--theme-accent': 'accent' in theme ? theme.accent : undefined } as CSSProperties}
                disabled={loading || switching !== null || selected}
                onClick={() => choose(theme.id)}
              >
                <span>{theme.name}</span>
                {'nameEn' in theme && theme.nameEn && <small>{theme.nameEn}</small>}
                <small>{theme.tagline}</small>
                <small className="trs-theme-manager__state">
                  {selected ? '当前使用' : pending ? '正在切换…' : '切换到此主题'}
                </small>
              </button>
            )
          })}
        </div>
        {loading && <p className="trs-theme-manager__hint">正在读取已安装主题…</p>}
        {!loading && themes.length === 0 && <p className="trs-theme-manager__hint">尚未发现扩展主题。</p>}
        {current === 'unknown' && <p className="trs-theme-manager__hint">检测到未登记的主题状态，可选择任一主题修复。</p>}
        {error !== null && <p className="trs-theme-manager__error">操作失败：{error}</p>}
      </section>
    </div>
  )
}

/** DSH 多主题管理器的宿主端：发现主题、互斥切换并提供同源接口。 */
import type { Context } from '@deepseek-ai/cordis'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { THEME_MANAGER_ROUTE, type ThemeCatalogEntry, type ThemeTarget } from './contract.js'

export { THEME_MANAGER_ROUTE, type ThemeCatalogEntry, type ThemeTarget } from './contract.js'

export const name = 'trs-aip-theme-manager'
export const inject = ['webServer']

export const MANAGED_START = '# --- trs-aip theme managed (auto-generated; do not edit) ---'
export const MANAGED_END = '# --- end trs-aip theme managed ---'

interface WebRoute {
  kind: 'exact'
  path: string
  handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
}

type HostContext = Context & {
  webServer: { register(route: WebRoute): () => void }
}

interface ThemeManifest {
  id?: unknown
  name?: unknown
  nameEn?: unknown
  tagline?: unknown
  accent?: unknown
  package?: unknown
  bodyAttr?: unknown
  order?: unknown
  wiring?: { id?: unknown }
}

/** 定位当前 Web profile；不读取凭据和无关配置。 */
export function resolveProfilePatch(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  const configuredHome = env.DSH_HOME?.trim()
  const harnessHome = configuredHome ? resolve(configuredHome) : join(homedir(), '.dsh')
  const explicitProfile = env.DSH_THEME_PROFILE?.trim() || env.DSH_PROFILE?.trim()
  const profilesDir = join(harnessHome, 'profiles')
  const inferredProfile = dirname(resolve(cwd)) === resolve(profilesDir) ? basename(resolve(cwd)) : undefined
  const profile = explicitProfile || inferredProfile || 'web'
  if (!/^[a-zA-Z0-9._-]+$/.test(profile)) throw new Error('invalid-profile-name')
  return join(profilesDir, profile, 'cordis.patch.yml')
}

/** profile 层和优先级更高的 home 层必须保持一致。 */
export function resolvePatchTargets(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string[] {
  const profilePatch = resolveProfilePatch(env, cwd)
  return [profilePatch, join(dirname(dirname(dirname(profilePatch))), 'cordis.patch.yml')]
}

function installedPackageNames(profileManifest: string): string[] {
  try {
    const manifest = JSON.parse(readFileSync(profileManifest, 'utf8')) as {
      dependencies?: Record<string, unknown>
      dsh?: { profile?: { bundles?: unknown[] } }
    }
    const names = new Set(Object.keys(manifest.dependencies ?? {}))
    for (const entry of manifest.dsh?.profile?.bundles ?? []) {
      if (typeof entry === 'string') names.add(entry)
    }
    return [...names]
  } catch {
    return []
  }
}

function resolveSkinManifest(profileManifest: string, packageName: string): string | null {
  const require = createRequire(profileManifest)
  try {
    return require.resolve(`${packageName}/skin.json`)
  } catch {
    try {
      const packageJson = require.resolve(`${packageName}/package.json`)
      const candidate = join(dirname(packageJson), 'skin.json')
      return existsSync(candidate) ? candidate : null
    } catch {
      const candidate = join(dirname(profileManifest), 'node_modules', ...packageName.split('/'), 'skin.json')
      return existsSync(candidate) ? candidate : null
    }
  }
}

function catalogEntry(raw: ThemeManifest, installedPackage: string): ThemeCatalogEntry | null {
  if (typeof raw.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(raw.id)) return null
  if (typeof raw.name !== 'string' || raw.name.trim() === '') return null
  if (raw.package !== installedPackage) return null
  if (typeof raw.wiring?.id !== 'string' || !/^[a-zA-Z0-9@/_.:-]+$/.test(raw.wiring.id)) return null
  if (typeof raw.bodyAttr !== 'string' || !/^data-[a-z0-9_.:-]+$/.test(raw.bodyAttr)) return null
  return {
    id: raw.id,
    name: raw.name,
    ...(typeof raw.nameEn === 'string' ? { nameEn: raw.nameEn } : {}),
    ...(typeof raw.tagline === 'string' ? { tagline: raw.tagline } : {}),
    ...(typeof raw.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.accent) ? { accent: raw.accent } : {}),
    package: installedPackage,
    wiringId: raw.wiring.id,
    bodyAttr: raw.bodyAttr,
    order: typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : 100,
  }
}

/** 发现所有安装了有效 skin.json 的主题包，而非硬编码某一主题。 */
export function discoverInstalledThemes(profilePatch = resolveProfilePatch()): ThemeCatalogEntry[] {
  const profileManifest = join(dirname(profilePatch), 'package.json')
  const found: ThemeCatalogEntry[] = []
  const ids = new Set<string>()
  const wiringIds = new Set<string>()
  for (const packageName of installedPackageNames(profileManifest)) {
    const manifestPath = resolveSkinManifest(profileManifest, packageName)
    if (manifestPath === null) continue
    try {
      const entry = catalogEntry(JSON.parse(readFileSync(manifestPath, 'utf8')) as ThemeManifest, packageName)
      if (entry === null || ids.has(entry.id) || wiringIds.has(entry.wiringId)) continue
      ids.add(entry.id)
      wiringIds.add(entry.wiringId)
      found.push(entry)
    } catch {
      // 一个损坏的第三方主题清单不应影响其他主题。
    }
  }
  return found.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
}

/** 只移除管理器拥有的区段，保留用户和其他插件的 YAML。 */
export function stripManagedBlock(source: string): string {
  const start = source.indexOf(MANAGED_START)
  if (start < 0) return source
  const end = source.indexOf(MANAGED_END, start)
  if (end < 0) throw new Error('managed-section-is-incomplete')
  const before = source.slice(0, start).replace(/[ \t]+$/gm, '').replace(/\s+$/, '')
  const after = source.slice(end + MANAGED_END.length).replace(/^\s+/, '')
  return [before, after].filter(Boolean).join('\n\n')
}

/** 主题始终互斥；品牌、Logo 与其他非主题插件保持原有状态。 */
export function renderManagedBlock(target: ThemeTarget, catalog: ThemeCatalogEntry[]): string {
  const lines = [MANAGED_START]
  for (const theme of catalog) {
    lines.push(`- id: ${theme.wiringId}`, `  disabled: ${theme.id === target ? 'false' : 'true'}`)
  }
  lines.push(MANAGED_END)
  return lines.join('\n')
}

export function switchPatch(source: string, target: ThemeTarget, catalog: ThemeCatalogEntry[]): string {
  const stripped = stripManagedBlock(source).replace(/\s+$/, '')
  const lines = stripped.split(/\r?\n/)
  const yamlLines = lines.filter(line => line.trim() !== '' && !line.trimStart().startsWith('#'))
  const unmanaged = yamlLines.length === 1 && yamlLines[0]!.trim() === '[]'
    ? lines.filter(line => line.trim() !== '[]').join('\n').replace(/\s+$/, '')
    : stripped
  return `${unmanaged === '' ? '' : `${unmanaged}\n\n`}${renderManagedBlock(target, catalog)}\n`
}

function atomicWrite(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.tmp`)
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx', 0o600)
    writeFileSync(fd, text, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temporary, path)
  } finally {
    if (fd !== undefined) closeSync(fd)
    if (existsSync(temporary)) rmSync(temporary, { force: true })
  }
}

/** 将目标原子地写入两层配置；任一层失败时回滚已写层。 */
export function useTheme(
  target: ThemeTarget,
  patchPaths = resolvePatchTargets(),
  catalog = discoverInstalledThemes(patchPaths[0]),
): void {
  if (target !== 'official' && !catalog.some(theme => theme.id === target)) {
    throw new Error(`theme-not-installed: ${target}`)
  }
  const originals = patchPaths.map(path => ({
    path,
    existed: existsSync(path),
    source: existsSync(path) ? readFileSync(path, 'utf8') : '',
  }))
  const written: typeof originals = []
  try {
    originals.forEach((original) => {
      atomicWrite(original.path, switchPatch(original.source, target, catalog))
      written.push(original)
    })
  } catch (error) {
    for (const original of written.reverse()) {
      if (original.existed) atomicWrite(original.path, original.source)
      else rmSync(original.path, { force: true })
    }
    throw error
  }
}

/** 读取一个 patch 层内各主题最后一次显式 disabled 状态。 */
export function readThemeStates(source: string, catalog: ThemeCatalogEntry[]): Map<string, boolean> {
  const known = new Set(catalog.map(theme => theme.wiringId))
  const states = new Map<string, boolean>()
  let currentId: string | undefined
  let currentIndent = -1
  let propertyIndent: number | undefined
  for (const line of source.split(/\r?\n/)) {
    const entry = line.match(/^(\s*)-\s+id:\s*(['"]?)([^'"#\s]+)\2\s*(?:#.*)?$/)
    if (entry !== null) {
      if (entry[1]!.length !== 0) continue
      currentId = known.has(entry[3]!) ? entry[3] : undefined
      currentIndent = entry[1]!.length
      propertyIndent = undefined
      continue
    }
    if (currentId === undefined) continue
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    if (indent <= currentIndent) {
      currentId = undefined
      continue
    }
    propertyIndent = propertyIndent === undefined ? indent : Math.min(propertyIndent, indent)
    const disabled = line.match(/^\s*disabled:\s*(true|false)\s*(?:#.*)?$/)
    if (disabled !== null && indent === propertyIndent) states.set(currentId, disabled[1] === 'true')
  }
  return states
}

/** home 层覆盖 profile 层，未显式禁用的已安装主题视为启用。 */
export function enabledThemes(sources: string[], catalog: ThemeCatalogEntry[]): ThemeCatalogEntry[] {
  const states = new Map<string, boolean>()
  for (const source of sources) {
    for (const [id, disabled] of readThemeStates(source, catalog)) states.set(id, disabled)
  }
  return catalog.filter(theme => states.get(theme.wiringId) !== true)
}

/** 早期版本曾错误地把品牌插件写进主题区段；启动时识别并迁移掉这些行。 */
function hasLegacyBrandOverrides(source: string): boolean {
  const start = source.indexOf(MANAGED_START)
  if (start < 0) return false
  const end = source.indexOf(MANAGED_END, start)
  if (end < 0) return false
  const managed = source.slice(start, end)
  return /^- id: (?:trs-aip-client-branding|ui-brand-official)$/m.test(managed)
}

/** 首次安装时接管当前单主题；若多个主题同时启用则安全回退原版。 */
export function ensureSafeInitialState(
  patchPaths = resolvePatchTargets(),
  catalog = discoverInstalledThemes(patchPaths[0]),
): boolean {
  if (catalog.length === 0) return false
  const sources = patchPaths.map(path => existsSync(path) ? readFileSync(path, 'utf8') : '')
  const alreadyManaged = sources.every(source => source.includes(MANAGED_START) && source.includes(MANAGED_END))
  const needsBrandMigration = sources.some(hasLegacyBrandOverrides)
  const enabled = enabledThemes(sources, catalog)
  if (alreadyManaged && enabled.length <= 1 && !needsBrandMigration) return false
  useTheme(enabled.length === 1 ? enabled[0]!.id : 'official', patchPaths, catalog)
  return true
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function sameOrigin(req: IncomingMessage): boolean {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 16_384) {
        reject(new Error('body-too-large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolveBody(chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

export function makeThemeManagerRoute(
  catalogProvider: () => ThemeCatalogEntry[] = () => discoverInstalledThemes(),
  applyTarget: (target: ThemeTarget, catalog: ThemeCatalogEntry[]) => void = (target, catalog) => useTheme(target, resolvePatchTargets(), catalog),
): WebRoute {
  return {
    kind: 'exact',
    path: THEME_MANAGER_ROUTE,
    async handler(req, res): Promise<void> {
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, error: 'cross-site-request-rejected' })
        return
      }
      try {
        const catalog = catalogProvider()
        if (req.method === 'GET') {
          json(res, 200, { ok: true, themes: catalog })
          return
        }
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method-not-allowed' })
          return
        }
        const body = await readBody(req)
        const target = typeof body === 'object' && body !== null ? (body as { target?: unknown }).target : undefined
        if (target !== 'official' && !catalog.some(theme => theme.id === target)) {
          throw new Error('invalid-theme-target')
        }
        applyTarget(target as ThemeTarget, catalog)
        json(res, 200, { ok: true, target })
      } catch (error) {
        json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}

export function apply(ctx: HostContext): void {
  ctx.effect(() => {
    try {
      ensureSafeInitialState()
    } catch (error) {
      console.error('[trs-aip-theme-manager] failed to enforce startup mutual exclusion', error)
    }
    return ctx.webServer.register(makeThemeManagerRoute())
  }, 'trs-aip-theme-manager: startup guard, catalog and activation route')
}

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { desktopRoot, readJson, TRS_PACKAGES } from './shared.mjs'

function requireFile(path) {
  if (!existsSync(path)) throw new Error(`desktop distribution is missing ${path}`)
}

function assertNoLinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      throw new Error(`desktop runtime must not contain symbolic links or directory junctions: ${path}`)
    }
    if (stat.isDirectory()) assertNoLinks(path)
  }
}

for (const path of [
  join(desktopRoot, 'lib', 'main.mjs'),
  join(desktopRoot, 'lib', 'preload.mjs'),
  join(desktopRoot, 'build', 'app-icon.png'),
  join(desktopRoot, 'build', 'installer.nsh'),
  join(desktopRoot, 'resources', 'splash.html'),
  join(desktopRoot, 'runtime', 'runtime-manifest.json'),
  join(desktopRoot, 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  join(desktopRoot, 'runtime', 'node_modules', '@deepseek-ai', 'dsh-host-directory-picker-native', 'lib', 'worker.cjs'),
  join(desktopRoot, 'runtime', 'node_modules', '@koromix', 'koffi-win32-x64', 'win32_x64', 'koffi.node'),
]) requireFile(path)

const desktopPackage = readJson(join(desktopRoot, 'package.json'))
if (desktopPackage.build?.electronFuses?.runAsNode !== true) {
  throw new Error('desktop distribution must enable the Electron runAsNode fuse for packaged Node workers')
}
const pickerHost = readFileSync(join(
  desktopRoot, 'runtime', 'node_modules', '@deepseek-ai', 'dsh-host-directory-picker-native', 'lib', 'index.js',
), 'utf8')
if (!/ELECTRON_RUN_AS_NODE:\s*["']1["']/u.test(pickerHost)) {
  throw new Error('desktop runtime picker worker must opt into Electron Node mode')
}
const pickerWorker = readFileSync(join(
  desktopRoot, 'runtime', 'node_modules', '@deepseek-ai', 'dsh-host-directory-picker-native', 'lib', 'worker.cjs',
), 'utf8')
const utf16ReaderBody = /function readUtf16\([^)]*\) \{\r?\n([\s\S]*?)\r?\n\}/u.exec(pickerWorker)?.[1]
const safeUtf16Reader = utf16ReaderBody !== undefined
  && !/koffi\.view\(address/u.test(utf16ReaderBody)
  && (/koffi\.decode\.string16\(address\)/u.test(utf16ReaderBody)
    || (/Buffer\.alloc\(/u.test(utf16ReaderBody) && /koffi\.decode\([\s\S]*?["']str16["']\)/u.test(utf16ReaderBody)))
if (!safeUtf16Reader) {
  throw new Error('desktop runtime picker worker must decode its COM string without an Electron external buffer')
}
const desktopMain = readFileSync(join(desktopRoot, 'lib', 'main.mjs'), 'utf8')
for (const marker of [
  'createStartupWindow',
  "appResource('resources', 'splash.html')",
  'destroyStartupWindow',
  "window.on('page-title-updated'",
]) {
  if (!desktopMain.includes(marker)) throw new Error(`desktop main entry lost startup-window lifecycle marker ${marker}`)
}
const splash = readFileSync(join(desktopRoot, 'resources', 'splash.html'), 'utf8')
if (!/Content-Security-Policy/u.test(splash) || /<script(?:\s|>)/iu.test(splash)) {
  throw new Error('desktop startup page must have a Content Security Policy and no scripts')
}
if (!splash.includes('广州拓尔思大数据有限公司')) {
  throw new Error('desktop startup page must identify Guangzhou TRS Big Data Co., Ltd.')
}
const requiredCoreModules = /const REQUIRED_CORE_CLIENT_MODULES\s*=\s*\[([\s\S]*?)\]/u.exec(desktopMain)?.[1]
const managedThemeModules = /const MANAGED_THEME_CLIENT_MODULES\s*=\s*\[([\s\S]*?)\]/u.exec(desktopMain)?.[1]
if (requiredCoreModules === undefined || requiredCoreModules.includes('@trs-aip/dsh-skin-china-police')) {
  throw new Error('desktop core client checks must not require a selectable skin')
}
if (managedThemeModules === undefined || !managedThemeModules.includes('@trs-aip/dsh-skin-china-police')) {
  throw new Error('desktop client checks must recognize the China Police skin as a managed theme')
}

const runtime = readJson(join(desktopRoot, 'runtime', 'runtime-manifest.json'))
if (runtime.schemaVersion !== 2 || !Array.isArray(runtime.rootPackages) || !Array.isArray(runtime.excludedDshPackages)) {
  throw new Error('desktop runtime manifest has no verified root dependency closure')
}
const versions = new Set(runtime.dshPackages
  .filter(entry => entry.name === '@deepseek-ai/dsh' || entry.name.startsWith('@deepseek-ai/dsh-'))
  .map(entry => entry.version))
if (versions.size !== 1 || !versions.has(runtime.versions.dsh)) {
  throw new Error(`desktop runtime mixes DSH versions: ${[...versions].join(', ')}`)
}
const installedDeepSeekRoot = join(desktopRoot, 'runtime', 'node_modules', '@deepseek-ai')
const rootPackageNames = new Set()
const rootPackageManifests = new Map()
for (const requirement of runtime.rootPackages) {
  if (typeof requirement?.name !== 'string' || typeof requirement?.version !== 'string') {
    throw new Error('desktop runtime manifest contains an invalid root package requirement')
  }
  if (rootPackageNames.has(requirement.name)) {
    throw new Error(`desktop runtime manifest contains duplicate root package ${requirement.name}`)
  }
  rootPackageNames.add(requirement.name)
  const manifestPath = join(desktopRoot, 'runtime', 'node_modules', ...requirement.name.split('/'), 'package.json')
  requireFile(manifestPath)
  const manifest = readJson(manifestPath)
  if (manifest.name !== requirement.name || manifest.version !== requirement.version) {
    throw new Error(`root package ${requirement.name} has unexpected identity ${String(manifest.name)}@${String(manifest.version)}`)
  }
  rootPackageManifests.set(requirement.name, manifest)
}

const localDeepSeekPackages = new Set(runtime.dshPackages.map(entry => entry.name))
const excludedDeepSeekPackages = new Set(runtime.excludedDshPackages)
function requireRootDependency(dependency, consumer, optional) {
  if (!localDeepSeekPackages.has(dependency)) return
  if (excludedDeepSeekPackages.has(dependency)) {
    if (optional) return
    throw new Error(`required package ${dependency} used by ${consumer} was excluded from the desktop platform`)
  }
  if (!rootPackageNames.has(dependency)) {
    throw new Error(`root package closure is missing ${dependency} required by ${consumer}`)
  }
}
for (const [name, manifest] of rootPackageManifests) {
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    requireRootDependency(dependency, name, false)
  }
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
    requireRootDependency(dependency, name, true)
  }
  for (const dependency of Object.keys(manifest.peerDependencies ?? {})) {
    if (manifest.peerDependenciesMeta?.[dependency]?.optional !== true) {
      requireRootDependency(dependency, name, false)
    }
  }
}
assertNoLinks(join(desktopRoot, 'runtime'))

for (const entry of readdirSync(installedDeepSeekRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || (entry.name !== 'dsh' && !entry.name.startsWith('dsh-'))) continue
  const manifest = readJson(join(installedDeepSeekRoot, entry.name, 'package.json'))
  if (manifest.version !== runtime.versions.dsh) {
    throw new Error(`installed ${manifest.name}@${String(manifest.version)} differs from DSH ${runtime.versions.dsh}`)
  }
}
for (const name of TRS_PACKAGES) {
  if (typeof runtime.versions[name] !== 'string') throw new Error(`runtime has no version for ${name}`)
  const packageDir = join(desktopRoot, 'runtime', 'node_modules', ...name.split('/'))
  for (const relative of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) requireFile(join(packageDir, relative))
  const manifest = readJson(join(packageDir, 'package.json'))
  for (const [peer, specifier] of Object.entries(manifest.peerDependencies ?? {})) {
    if (peer.startsWith('@deepseek-ai/dsh-') && specifier !== runtime.versions.dsh) {
      throw new Error(`${name} expects ${peer}@${specifier}; desktop runtime is ${runtime.versions.dsh}`)
    }
  }
}

const profile = readFileSync(join(desktopRoot, 'resources', 'profile', 'package.json'), 'utf8')
for (const placeholder of ['__DSH_VERSION__', '__BRANDING_VERSION__', '__MCP_VERSION__', '__THEME_VERSION__', '__SKIN_VERSION__']) {
  if (!profile.includes(placeholder)) throw new Error(`desktop profile template lost placeholder ${placeholder}`)
}
if (!/"patchReload"\s*:\s*"startup"/u.test(profile)) {
  throw new Error('desktop profile must use restart-based patch reload under Electron')
}
const icon = readFileSync(join(desktopRoot, 'build', 'app-icon.png'))
if (!icon.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
  throw new Error('desktop application icon is not a PNG')
}
console.log(`Desktop distribution check passed (${createHash('sha256').update(icon).digest('hex').slice(0, 12)})`)

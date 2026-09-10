import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import {
  assertInside,
  desktopRoot,
  harnessRoot,
  packageSupportsCurrentPlatform,
  readJson,
  readPackedManifest,
  spawnPnpmSync,
  TRS_PACKAGES,
} from './shared.mjs'

const dshVendorRoot = join(desktopRoot, 'vendor', 'dsh-runtime')
const dshVersion = readJson(join(harnessRoot, 'package.json')).version
if (typeof dshVersion !== 'string' || dshVersion === '') {
  throw new Error('the local deepseek-harness package has no version')
}
const versions = []
for (const entry of readdirSync(dshVendorRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && !entry.name.startsWith('.')) versions.push(entry.name)
}
if (!versions.includes(dshVersion)) {
  throw new Error(
    `vendored DSH runtime for current Harness ${dshVersion} is missing; available: ${versions.join(', ') || '(none)'}`,
  )
}
const dshDir = assertInside(dshVendorRoot, join(dshVendorRoot, dshVersion), 'current DSH runtime directory')
const dshManifest = readJson(join(dshDir, 'manifest.json'))
const trsManifest = readJson(join(desktopRoot, 'vendor', 'trs-plugins', 'manifest.json'))
if (dshManifest.version !== dshVersion) throw new Error('DSH vendor directory and manifest version differ')

const runtimeDir = assertInside(desktopRoot, join(desktopRoot, 'runtime'), 'desktop runtime directory')
rmSync(runtimeDir, { recursive: true, force: true })
mkdirSync(runtimeDir, { recursive: true })

const fileSpecifier = path => `file:${relative(runtimeDir, path).replaceAll('\\', '/')}`
const dshPackages = new Map(dshManifest.packages.map(entry => [entry.name, entry]))
const trsPackages = new Map(trsManifest.packages.map(entry => [entry.name, entry]))
const dshPackageManifests = new Map()
const trsPackageManifests = new Map()
const excludedDeepSeekPackages = new Set()
for (const [root, entries] of [
  [dshDir, dshManifest.packages],
  [join(desktopRoot, 'vendor', 'trs-plugins'), trsManifest.packages],
]) {
  for (const entry of entries) {
    const tarball = join(root, entry.file)
    if (!existsSync(tarball)) throw new Error(`vendored package is missing ${tarball}`)
    const digest = createHash('sha256').update(readFileSync(tarball)).digest('hex')
    if (digest !== entry.sha256) throw new Error(`vendored package digest differs for ${entry.name}`)
    const packedManifest = readPackedManifest(tarball)
    if (packedManifest.name !== entry.name || packedManifest.version !== entry.version) {
      throw new Error(`vendored package identity differs for ${entry.name}`)
    }
    if (root === dshDir) {
      dshPackageManifests.set(entry.name, packedManifest)
      if (!packageSupportsCurrentPlatform(packedManifest)) {
        excludedDeepSeekPackages.add(entry.name)
      }
    } else {
      trsPackageManifests.set(entry.name, packedManifest)
    }
  }
}
const overrides = {}
for (const entry of dshManifest.packages) {
  overrides[entry.name] = excludedDeepSeekPackages.has(entry.name)
    ? '-'
    : fileSpecifier(join(dshDir, entry.file))
}

const localDeepSeekPackages = new Set(dshManifest.packages.map(entry => entry.name))
const missingDeepSeekPackages = new Map()
for (const [root, entries] of [
  [dshDir, dshManifest.packages],
  [join(desktopRoot, 'vendor', 'trs-plugins'), trsManifest.packages],
]) {
  for (const entry of entries) {
    const manifest = readPackedManifest(join(root, entry.file))
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const dependency of Object.keys(manifest[section] ?? {})) {
        if (!dependency.startsWith('@deepseek-ai/') || localDeepSeekPackages.has(dependency)) continue
        const consumers = missingDeepSeekPackages.get(dependency) ?? []
        consumers.push(manifest.name)
        missingDeepSeekPackages.set(dependency, consumers)
      }
    }
  }
}
if (missingDeepSeekPackages.size > 0) {
  const detail = [...missingDeepSeekPackages]
    .map(([name, consumers]) => `${name} (required by ${[...new Set(consumers)].join(', ')})`)
    .join('\n')
  throw new Error(`the local Harness tarball set is incomplete; refusing to fetch @deepseek-ai packages from a registry:\n${detail}`)
}

const requiredDeepSeekPackages = new Set()
function includeDeepSeekPackage(name, consumer, optional = false) {
  const entry = dshPackages.get(name)
  if (entry === undefined) {
    throw new Error(`desktop runtime dependency ${name} required by ${consumer} is not vendored`)
  }
  if (excludedDeepSeekPackages.has(name)) {
    if (optional) return
    throw new Error(`desktop runtime dependency ${name} required by ${consumer} does not support ${process.platform} ${process.arch}`)
  }
  if (requiredDeepSeekPackages.has(name)) return
  requiredDeepSeekPackages.add(name)

  const manifest = dshPackageManifests.get(name)
  if (manifest === undefined) throw new Error(`desktop runtime has no manifest for ${name}`)
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    if (localDeepSeekPackages.has(dependency)) includeDeepSeekPackage(dependency, name)
  }
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {}).sort()) {
    if (localDeepSeekPackages.has(dependency)) includeDeepSeekPackage(dependency, name, true)
  }
  for (const dependency of Object.keys(manifest.peerDependencies ?? {}).sort()) {
    if (!localDeepSeekPackages.has(dependency)) continue
    const peerOptional = manifest.peerDependenciesMeta?.[dependency]?.optional === true
    if (!peerOptional) includeDeepSeekPackage(dependency, name)
  }
}

for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']) {
  includeDeepSeekPackage(name, '@trs-aip/desktop-runtime')
}
for (const name of TRS_PACKAGES) {
  const manifest = trsPackageManifests.get(name)
  if (manifest === undefined) throw new Error(`vendored TRS plugin set is missing ${name}`)
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(manifest[section] ?? {}).sort()) {
      if (!localDeepSeekPackages.has(dependency)) continue
      const optionalPeer = section === 'peerDependencies'
        && manifest.peerDependenciesMeta?.[dependency]?.optional === true
      if (!optionalPeer) includeDeepSeekPackage(dependency, name, section === 'optionalDependencies')
    }
  }
}

const dependencies = {}
for (const name of [...requiredDeepSeekPackages].sort()) {
  const entry = dshPackages.get(name)
  dependencies[name] = fileSpecifier(join(dshDir, entry.file))
}
for (const name of TRS_PACKAGES) {
  const entry = trsPackages.get(name)
  if (entry === undefined) throw new Error(`vendored TRS plugin set is missing ${name}`)
  dependencies[name] = fileSpecifier(join(desktopRoot, 'vendor', 'trs-plugins', entry.file))
}
dependencies.pnpm = '11.7.0'

const subprocessPackageName = '@deepseek-ai/dsh-subprocess-local'
const subprocessEntry = dshPackages.get(subprocessPackageName)
if (subprocessEntry === undefined || !requiredDeepSeekPackages.has(subprocessPackageName)) {
  throw new Error(`desktop runtime closure is missing required build package ${subprocessPackageName}`)
}
const subprocessSpecifier = fileSpecifier(join(dshDir, subprocessEntry.file))
const subprocessBuildIdentity = `${subprocessPackageName}@${subprocessSpecifier}`

const rootPackages = [
  ...[...requiredDeepSeekPackages].map(name => ({ name, version: dshPackages.get(name).version })),
  ...TRS_PACKAGES.map(name => ({ name, version: trsPackages.get(name).version })),
  { name: 'pnpm', version: '11.7.0' },
].sort((left, right) => left.name.localeCompare(right.name))

const runtimePackage = {
  name: '@trs-aip/desktop-runtime',
  version: readJson(join(desktopRoot, 'package.json')).version,
  private: true,
  type: 'module',
  packageManager: 'pnpm@11.7.0',
  dependencies,
}
writeFileSync(join(runtimeDir, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`, 'utf8')
writeFileSync(join(runtimeDir, 'pnpm-workspace.yaml'), `${[
  'packages:',
  "  - '.'",
  'nodeLinker: hoisted',
  'autoInstallPeers: true',
  '',
  'overrides:',
  ...Object.entries(overrides)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, specifier]) => `  ${JSON.stringify(name)}: ${JSON.stringify(specifier)}`),
  '',
  'allowBuilds:',
  `  ${JSON.stringify(subprocessBuildIdentity)}: true`,
  "  '@google/genai': false",
  '  esbuild: true',
  '  koffi: true',
  '  node-addon-require-builtin: false',
  '  node-pty: true',
  '  protobufjs: false',
].join('\n')}\n`, 'utf8')

const result = spawnPnpmSync([
  '--dir', runtimeDir, '--filter', '@trs-aip/desktop-runtime',
  'install', '--prod', '--no-frozen-lockfile',
], { cwd: desktopRoot, stdio: 'inherit' })
if (result.error !== undefined) throw result.error
if (result.status !== 0) throw new Error(`desktop runtime installation exited with ${String(result.status)}`)

// The upstream picker assumes process.execPath is node.exe. In the packaged
// Electron host it is the application EXE, so opt only this worker spawn into
// Electron's fuse-enabled Node mode. Keeping the flag inside the spawn env
// prevents Agent and MCP child commands from inheriting it.
const pickerHostPath = join(
  runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-host-directory-picker-native', 'lib', 'index.js',
)
const pickerHostSource = readFileSync(pickerHostPath, 'utf8')
const workerEnvironment = /(\.\.\.process\.env,)(\r?\n)([ \t]*)(DSH_DIALOG_TITLE:\s*data\.title)/u
if (!workerEnvironment.test(pickerHostSource)) {
  throw new Error('desktop runtime cannot locate the Win32 directory-picker worker environment')
}
writeFileSync(pickerHostPath, pickerHostSource.replace(
  workerEnvironment,
  '$1$2$3ELECTRON_RUN_AS_NODE: "1",$2$3$4',
), 'utf8')

// Koffi documents that Electron forbids the external ArrayBuffer created by
// koffi.view(). The upstream worker uses that API after IFileDialog returns a
// selected IShellItem, which makes Electron's Node mode terminate with a fatal
// N-API error before it can send the selected path over IPC. Decode the
// NUL-terminated UTF-16 pointer directly while its COM allocation is alive.
const pickerWorkerPath = join(
  runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-host-directory-picker-native', 'lib', 'worker.cjs',
)
const pickerWorkerSource = readFileSync(pickerWorkerPath, 'utf8')
const utf16Reader = /function readUtf16\(([^)]*)\) \{\r?\n([\s\S]*?)\r?\n\}/u
const utf16ReaderMatch = utf16Reader.exec(pickerWorkerSource)
if (utf16ReaderMatch === null) {
  throw new Error('desktop runtime cannot locate the directory-picker UTF-16 reader')
}
const utf16ReaderBody = utf16ReaderMatch[2]
if (utf16ReaderBody.includes('koffi.view(address')) {
  writeFileSync(pickerWorkerPath, pickerWorkerSource.replace(
    utf16Reader,
    `function readUtf16(${utf16ReaderMatch[1]}) {\n\treturn koffi.decode.string16(address);\n}`,
  ), 'utf8')
} else {
  const alreadySafe = utf16ReaderBody.includes('koffi.decode.string16(address)')
    || (/Buffer\.alloc\(/u.test(utf16ReaderBody) && /koffi\.decode\([\s\S]*?["']str16["']\)/u.test(utf16ReaderBody))
  if (!alreadySafe) throw new Error('desktop runtime directory-picker has an unrecognized UTF-16 reader')
}

for (const requirement of rootPackages) {
  const packageDir = join(runtimeDir, 'node_modules', ...requirement.name.split('/'))
  const manifestPath = join(packageDir, 'package.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`installed desktop runtime cannot resolve root package ${requirement.name}`)
  }
  const installedManifest = readJson(manifestPath)
  if (installedManifest.name !== requirement.name || installedManifest.version !== requirement.version) {
    throw new Error(`installed root package ${requirement.name} has unexpected identity ${String(installedManifest.name)}@${String(installedManifest.version)}`)
  }
}

for (const path of [
  join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-base', 'cordis.patch.yml'),
  join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh-web-app', 'cordis.patch.yml'),
  ...TRS_PACKAGES.flatMap(name => {
    const packageDir = join(runtimeDir, 'node_modules', ...name.split('/'))
    return [join(packageDir, 'lib', 'index.js'), join(packageDir, 'lib', 'client.js'), join(packageDir, 'cordis.patch.yml')]
  }),
]) {
  if (!existsSync(path)) throw new Error(`installed desktop runtime is incomplete: ${path}`)
}

const versionMap = { dsh: dshVersion }
for (const entry of trsManifest.packages) versionMap[entry.name] = entry.version
writeFileSync(join(runtimeDir, 'runtime-manifest.json'), `${JSON.stringify({
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  versions: versionMap,
  rootPackages,
  excludedDshPackages: [...excludedDeepSeekPackages].sort(),
  dshPackages: dshManifest.packages,
  trsPackages: trsManifest.packages,
}, null, 2)}\n`, 'utf8')
console.log(`Prepared closed desktop runtime with ${rootPackages.length} root packages for DSH ${dshVersion} in ${runtimeDir}`)

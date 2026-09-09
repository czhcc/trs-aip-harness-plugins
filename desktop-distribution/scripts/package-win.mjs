import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { desktopRoot, readJson, spawnPnpmSync } from './shared.mjs'

const requestedTargets = process.argv.slice(2)
const targets = requestedTargets.length === 0 ? ['nsis', 'zip'] : requestedTargets
if (targets.some(target => target !== 'nsis' && target !== 'zip')) {
  throw new Error(`Windows package target must be nsis or zip; received ${targets.join(', ')}`)
}
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`Windows packages require native Windows x64; received ${process.platform} ${process.arch}`)
}
const [majorText, minorText] = process.versions.node.split('.')
const major = Number(majorText)
const minor = Number(minorText)
if (!((major === 22 && minor >= 19) || major === 24)) {
  throw new Error(`Windows packages require Node 22.19+ or Node 24.x; received ${process.versions.node}`)
}

const signingKeys = new Set([
  'CSC_IDENTITY_AUTO_DISCOVERY', 'CSC_KEY_PASSWORD', 'CSC_LINK', 'CSC_NAME',
  'WIN_CSC_KEY_PASSWORD', 'WIN_CSC_LINK',
])
const environment = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
for (const key of Object.keys(environment)) {
  if (signingKeys.has(key.toUpperCase()) && key.toUpperCase() !== 'CSC_IDENTITY_AUTO_DISCOVERY') delete environment[key]
}

for (const target of targets) {
  console.log(`Building unsigned Windows x64 ${target === 'nsis' ? 'installer' : 'portable ZIP'}...`)
  const result = spawnPnpmSync([
    'dlx', 'electron-builder@26.15.7',
    '--win', target, '--x64', '--publish', 'never',
    '--config.npmRebuild=false',
  ], { cwd: desktopRoot, env: environment, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`electron-builder ${target} exited with ${String(result.status)}`)
}

function assertPe(path, label) {
  const stat = statSync(path)
  if (!stat.isFile() || stat.size < 68) throw new Error(`${label} is empty: ${path}`)
  const descriptor = openSync(path, 'r')
  try {
    const dos = Buffer.alloc(64)
    if (readSync(descriptor, dos, 0, dos.length, 0) !== dos.length || dos.subarray(0, 2).toString('ascii') !== 'MZ') {
      throw new Error(`${label} has no Windows PE header: ${path}`)
    }
    const peOffset = dos.readUInt32LE(0x3c)
    const signature = Buffer.alloc(4)
    if (readSync(descriptor, signature, 0, 4, peOffset) !== 4 || !signature.equals(Buffer.from('PE\0\0'))) {
      throw new Error(`${label} has no Windows PE signature: ${path}`)
    }
  } finally {
    closeSync(descriptor)
  }
}

function zipEntries(path) {
  const data = readFileSync(path)
  const minimumEocd = 22
  const searchStart = Math.max(0, data.length - 65_535 - minimumEocd)
  let eocd = -1
  for (let index = data.length - minimumEocd; index >= searchStart; index -= 1) {
    if (data.readUInt32LE(index) === 0x06054b50) {
      eocd = index
      break
    }
  }
  if (eocd === -1) throw new Error(`portable archive has no ZIP end record: ${path}`)
  const total = data.readUInt16LE(eocd + 10)
  let offset = data.readUInt32LE(eocd + 16)
  const entries = []
  for (let index = 0; index < total; index += 1) {
    if (data.readUInt32LE(offset) !== 0x02014b50) throw new Error(`portable archive has an invalid central directory: ${path}`)
    const nameLength = data.readUInt16LE(offset + 28)
    const extraLength = data.readUInt16LE(offset + 30)
    const commentLength = data.readUInt16LE(offset + 32)
    entries.push(data.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replaceAll('\\', '/'))
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const version = readJson(join(desktopRoot, 'package.json')).version
const dist = join(desktopRoot, 'dist')
const application = join(dist, 'win-unpacked', 'TRS AIP Desktop.exe')
const unpackedRuntime = join(dist, 'win-unpacked', 'resources', 'app.asar.unpacked', 'runtime')
assertPe(application, 'unpacked application')
if (targets.includes('nsis')) assertPe(join(dist, `TRS-AIP-Desktop-${version}-x64-Setup.exe`), 'NSIS installer')
for (const required of [
  join(dist, 'win-unpacked', 'resources', 'app.asar'),
  join(unpackedRuntime, 'runtime-manifest.json'),
  join(unpackedRuntime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
]) {
  if (!existsSync(required)) throw new Error(`packaged runtime is missing ${required}`)
}
const packagedRuntime = readJson(join(unpackedRuntime, 'runtime-manifest.json'))
if (packagedRuntime.schemaVersion !== 2 || !Array.isArray(packagedRuntime.rootPackages)) {
  throw new Error('packaged runtime manifest has no verified root dependency closure')
}
for (const requirement of packagedRuntime.rootPackages) {
  const manifestPath = join(unpackedRuntime, 'node_modules', ...requirement.name.split('/'), 'package.json')
  if (!existsSync(manifestPath)) throw new Error(`packaged runtime is missing root package ${requirement.name}`)
  const manifest = readJson(manifestPath)
  if (manifest.name !== requirement.name || manifest.version !== requirement.version) {
    throw new Error(`packaged root package ${requirement.name} has unexpected identity ${String(manifest.name)}@${String(manifest.version)}`)
  }
}
if (targets.includes('zip')) {
  const archive = join(dist, `TRS-AIP-Desktop-${version}-x64-Portable.zip`)
  const zip = Buffer.alloc(4)
  const descriptor = openSync(archive, 'r')
  try {
    readSync(descriptor, zip, 0, 4, 0)
  } finally {
    closeSync(descriptor)
  }
  if (zip.readUInt32LE(0) !== 0x04034b50) throw new Error(`portable archive has no ZIP header: ${archive}`)
  const entries = new Set(zipEntries(archive))
  const zipRequirements = [
    'TRS AIP Desktop.exe',
    'resources/app.asar',
    'resources/app.asar.unpacked/runtime/runtime-manifest.json',
    ...packagedRuntime.rootPackages.map(requirement => `resources/app.asar.unpacked/runtime/node_modules/${requirement.name}/package.json`),
  ]
  for (const required of zipRequirements) {
    if (!entries.has(required)) throw new Error(`portable archive is missing ${required}: ${archive}`)
  }
}
console.log(`Verified unsigned Windows artifacts in ${dist}`)

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import {
  assertInside,
  desktopRoot,
  DSH_PACKAGE_PREFIX,
  expectedTarballName,
  harnessRoot,
  packageSupportsCurrentPlatform,
  readJson,
  readPackedEntries,
  readPackedManifest,
  spawnNpmSync,
  spawnPnpmSync,
} from './shared.mjs'

const vendorRoot = join(desktopRoot, 'vendor', 'dsh-runtime')
const harnessVersion = readJson(join(harnessRoot, 'package.json')).version
if (typeof harnessVersion !== 'string' || harnessVersion === '') {
  throw new Error('the local deepseek-harness package has no version')
}

function createPackSource() {
  const staging = assertInside(vendorRoot, join(vendorRoot, '.pack-staging'), 'DSH pack staging directory')
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })

  const memberDirs = []
  for (const group of readdirSync(join(harnessRoot, 'packages'), { withFileTypes: true })) {
    if (!group.isDirectory() || group.name === 'experimental') continue
    for (const member of readdirSync(join(harnessRoot, 'packages', group.name), { withFileTypes: true })) {
      const directory = join(harnessRoot, 'packages', group.name, member.name)
      if (member.isDirectory() && existsSync(join(directory, 'package.json'))) memberDirs.push(directory)
    }
  }
  for (const member of readdirSync(join(harnessRoot, 'apps'), { withFileTypes: true })) {
    const directory = join(harnessRoot, 'apps', member.name)
    if (member.isDirectory() && existsSync(join(directory, 'package.json'))) memberDirs.push(directory)
  }
  for (const member of readdirSync(join(harnessRoot, 'vendor'), { withFileTypes: true })) {
    const directory = join(harnessRoot, 'vendor', member.name)
    if (member.isDirectory() && existsSync(join(directory, 'package.json'))) memberDirs.push(directory)
  }
  const nativePackages = join(harnessRoot, 'native', 'landlock-run', 'packages')
  if (existsSync(nativePackages)) {
    for (const member of readdirSync(nativePackages, { withFileTypes: true })) {
      const directory = join(nativePackages, member.name)
      if (member.isDirectory() && existsSync(join(directory, 'package.json'))) memberDirs.push(directory)
    }
  }

  const members = new Map(memberDirs.map(directory => {
    const manifest = readJson(join(directory, 'package.json'))
    if (typeof manifest.name !== 'string' || !manifest.name.startsWith(DSH_PACKAGE_PREFIX)) {
      throw new Error(`invalid DSH release package at ${directory}`)
    }
    const belongsToDshRelease = manifest.name === '@deepseek-ai/dsh' || manifest.name.startsWith('@deepseek-ai/dsh-')
    if (belongsToDshRelease && manifest.version !== harnessVersion) {
      throw new Error(`${manifest.name} is ${String(manifest.version)}; expected ${harnessVersion}`)
    }
    return [manifest.name, { directory, manifest }]
  }))
  const ordered = []
  const visiting = new Set()
  const visited = new Set()
  const visit = name => {
    if (visited.has(name)) return
    if (visiting.has(name)) throw new Error(`DSH package dependency cycle reaches ${name}`)
    visiting.add(name)
    const member = members.get(name)
    for (const section of ['dependencies', 'optionalDependencies']) {
      for (const dependency of Object.keys(member.manifest[section] ?? {}).sort()) {
        if (members.has(dependency)) visit(dependency)
      }
    }
    visiting.delete(name)
    visited.add(name)
    ordered.push(member)
  }
  for (const name of [...members.keys()].sort()) visit(name)

  const order = []
  for (const member of ordered) {
    const result = !packageSupportsCurrentPlatform(member.manifest)
      ? spawnNpmSync([
        'pack', '--ignore-scripts', '--pack-destination', staging,
      ], { cwd: member.directory, stdio: 'inherit' })
      : spawnPnpmSync([
        '--dir', member.directory, 'pack', '--pack-destination', staging,
      ], { cwd: desktopRoot, stdio: 'inherit' })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`packing ${member.manifest.name} exited with ${String(result.status)}`)
    order.push(expectedTarballName(member.manifest.name, member.manifest.version))
  }
  writeFileSync(join(staging, 'publish-order.txt'), `${order.join('\n')}\n`, 'utf8')
  return staging
}

const configuredSource = process.env.DSH_TARBALL_SOURCE
const source = configuredSource === undefined
  ? createPackSource()
  : resolve(configuredSource)
const orderPath = join(source, 'publish-order.txt')
if (!existsSync(orderPath)) throw new Error(`DSH runtime source has no publish-order.txt: ${source}`)

const order = readFileSync(orderPath, 'utf8').split(/\r?\n/u).map(value => value.trim()).filter(Boolean)
if (order.length === 0) throw new Error(`DSH runtime publish order is empty: ${orderPath}`)

const target = assertInside(vendorRoot, join(vendorRoot, harnessVersion), 'versioned DSH runtime directory')
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })

const packages = []
const seen = new Set()
const requiredPayloads = new Map([
  ['@deepseek-ai/dsh', ['package/lib/bin.js']],
  ['@deepseek-ai/dsh-base', ['package/cordis.patch.yml']],
  ['@deepseek-ai/dsh-web-app', ['package/lib/index.js', 'package/cordis.patch.yml']],
  ['@deepseek-ai/dsh-web-frontend', ['package/dist/index.html']],
])
for (const filename of order) {
  if (basename(filename) !== filename || !filename.endsWith('.tgz')) {
    throw new Error(`invalid DSH tarball entry in publish-order.txt: ${filename}`)
  }
  const sourcePath = join(source, filename)
  if (!existsSync(sourcePath)) throw new Error(`missing DSH tarball: ${sourcePath}`)
  const manifest = readPackedManifest(sourcePath)
  if (typeof manifest.name !== 'string' || !manifest.name.startsWith(DSH_PACKAGE_PREFIX)) {
    throw new Error(`${filename} is not an @deepseek-ai package`)
  }
  const belongsToDshRelease = manifest.name === '@deepseek-ai/dsh' || manifest.name.startsWith('@deepseek-ai/dsh-')
  if (belongsToDshRelease && manifest.version !== harnessVersion) {
    throw new Error(`${manifest.name} is ${String(manifest.version)}; expected local Harness ${harnessVersion}`)
  }
  if (filename !== expectedTarballName(manifest.name, manifest.version)) {
    throw new Error(`${manifest.name} has unexpected tarball filename ${filename}`)
  }
  if (seen.has(manifest.name)) throw new Error(`duplicate DSH package ${manifest.name}`)
  seen.add(manifest.name)
  const requiredPayload = requiredPayloads.get(manifest.name)
  if (requiredPayload !== undefined) {
    const entries = new Set(readPackedEntries(sourcePath))
    for (const required of requiredPayload) {
      if (!entries.has(required)) throw new Error(`${manifest.name} tarball is missing ${required}`)
    }
  }
  const data = readFileSync(sourcePath)
  copyFileSync(sourcePath, join(target, filename))
  packages.push({
    name: manifest.name,
    version: manifest.version,
    file: filename,
    sha256: createHash('sha256').update(data).digest('hex'),
  })
}

for (const required of requiredPayloads.keys()) {
  if (!seen.has(required)) throw new Error(`DSH runtime is missing required package ${required}`)
}
writeFileSync(join(target, 'publish-order.txt'), `${order.join('\n')}\n`, 'utf8')
writeFileSync(join(target, 'manifest.json'), `${JSON.stringify({
  schemaVersion: 1,
  version: harnessVersion,
  generatedAt: new Date().toISOString(),
  packages,
}, null, 2)}\n`, 'utf8')
if (source === join(vendorRoot, '.pack-staging')) rmSync(source, { recursive: true, force: true })
console.log(`Synced ${packages.length} local Harness packages for DSH ${harnessVersion} to ${target}`)

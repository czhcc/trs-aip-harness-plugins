import { gunzipSync } from 'node:zlib'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const workspaceRoot = resolve(desktopRoot, '..')
export const repositoryRoot = resolve(workspaceRoot, '..')
export const harnessRoot = resolve(repositoryRoot, 'deepseek-harness')

export const DSH_PACKAGE_PREFIX = '@deepseek-ai/'
export const TRS_PACKAGES = [
  '@trs-aip/dsh-client-branding',
  '@trs-aip/dsh-mcp-settings',
  '@trs-aip/dsh-theme-manager',
  '@trs-aip/dsh-skin-china-police',
]

function isPnpmJavaScriptCli(path) {
  if (typeof path !== 'string' || path === '') return false
  const extension = extname(path).toLowerCase()
  return ['.cjs', '.js', '.mjs'].includes(extension)
    && basename(path).toLowerCase().includes('pnpm')
    && existsSync(path)
}

export function spawnPnpmSync(args, options) {
  const npmExecPath = process.env.npm_execpath
  if (isPnpmJavaScriptCli(npmExecPath)) {
    return spawnSync(process.execPath, [npmExecPath, ...args], options)
  }

  const searchDirectories = new Set([
    dirname(process.execPath),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
  ])
  for (const directory of searchDirectories) {
    const corepackEntry = join(directory, 'node_modules', 'corepack', 'dist', 'corepack.js')
    if (existsSync(corepackEntry)) {
      return spawnSync(process.execPath, [corepackEntry, 'pnpm', ...args], options)
    }
  }

  if (process.platform === 'win32') {
    throw new Error('Unable to locate the pnpm JavaScript CLI. Run this script with `corepack pnpm run ...` or install Corepack beside Node.js.')
  }
  return spawnSync('corepack', ['pnpm', ...args], options)
}

export function spawnNpmSync(args, options) {
  const searchDirectories = new Set([
    dirname(process.execPath),
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
  ])
  for (const directory of searchDirectories) {
    const npmEntry = join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (existsSync(npmEntry)) return spawnSync(process.execPath, [npmEntry, ...args], options)
  }

  if (process.platform === 'win32') {
    throw new Error('Unable to locate npm-cli.js beside Node.js. A standard Node.js installation is required to package platform-excluded dependencies.')
  }
  return spawnSync('npm', args, options)
}

export function assertInside(parent, target, label) {
  const resolvedParent = resolve(parent)
  const resolvedTarget = resolve(target)
  const offset = relative(resolvedParent, resolvedTarget)
  if (offset === '' || offset.startsWith('..') || isAbsolute(offset)) {
    throw new Error(`${label} must be a child of ${resolvedParent}: ${resolvedTarget}`)
  }
  return resolvedTarget
}

function tarString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset)
  return buffer.subarray(offset, end === -1 || end > offset + length ? offset + length : end).toString('utf8')
}

function tarNumber(buffer, offset, length) {
  const raw = tarString(buffer, offset, length).trim().replaceAll('\0', '')
  return raw === '' ? 0 : Number.parseInt(raw, 8)
}

export function readPackedManifest(tarball) {
  const archive = gunzipSync(readFileSync(tarball))
  let offset = 0
  while (offset + 512 <= archive.length) {
    const name = tarString(archive, offset, 100)
    if (name === '') break
    const prefix = tarString(archive, offset + 345, 155)
    const fullName = prefix === '' ? name : `${prefix}/${name}`
    const size = tarNumber(archive, offset + 124, 12)
    const bodyStart = offset + 512
    if (fullName === 'package/package.json') {
      return JSON.parse(archive.subarray(bodyStart, bodyStart + size).toString('utf8'))
    }
    offset = bodyStart + Math.ceil(size / 512) * 512
  }
  throw new Error(`${tarball} contains no package/package.json`)
}

export function readPackedEntries(tarball) {
  const archive = gunzipSync(readFileSync(tarball))
  const entries = []
  let offset = 0
  while (offset + 512 <= archive.length) {
    const name = tarString(archive, offset, 100)
    if (name === '') break
    const prefix = tarString(archive, offset + 345, 155)
    entries.push(prefix === '' ? name : `${prefix}/${name}`)
    const size = tarNumber(archive, offset + 124, 12)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return entries
}

export function extractPackedTarball(tarball, destination) {
  for (const entry of readPackedEntries(tarball)) {
    const normalized = entry.replaceAll('\\', '/')
    if (!normalized.startsWith('package/')
      || normalized.split('/').includes('..')
      || isAbsolute(normalized)) {
      throw new Error(`${tarball} contains an unsafe entry: ${entry}`)
    }
  }
  mkdirSync(destination, { recursive: true })
  const command = process.platform === 'win32' ? 'tar.exe' : 'tar'
  const result = spawnSync(command, [
    '-xzf', tarball, '-C', destination, '--strip-components', '1',
  ], { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`extracting ${tarball} exited with ${String(result.status)}`)
}

export function expectedTarballName(name, version) {
  return `${name.slice(1).replace('/', '-')}-${version}.tgz`
}

function platformListMatches(values, current) {
  if (!Array.isArray(values)) return true
  if (values.includes(`!${current}`)) return false
  const positive = values.filter(value => typeof value === 'string' && !value.startsWith('!'))
  return positive.length === 0 || positive.includes(current)
}

export function packageSupportsCurrentPlatform(manifest) {
  return platformListMatches(manifest.os, process.platform)
    && platformListMatches(manifest.cpu, process.arch)
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

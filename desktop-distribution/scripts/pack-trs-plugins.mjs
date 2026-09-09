import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertInside,
  desktopRoot,
  expectedTarballName,
  readJson,
  readPackedEntries,
  readPackedManifest,
  spawnPnpmSync,
  TRS_PACKAGES,
  workspaceRoot,
} from './shared.mjs'

const packageDirectories = new Map([
  ['@trs-aip/dsh-client-branding', 'client-branding'],
  ['@trs-aip/dsh-mcp-settings', 'mcp-settings'],
  ['@trs-aip/dsh-theme-manager', 'theme-manager'],
  ['@trs-aip/dsh-skin-china-police', 'skin-china-police'],
])
const vendorRoot = join(desktopRoot, 'vendor', 'trs-plugins')
const staging = assertInside(vendorRoot, join(vendorRoot, '.pack-staging'), 'TRS plugin pack staging directory')
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

const packed = []
for (const name of TRS_PACKAGES) {
  const directory = packageDirectories.get(name)
  const sourceManifest = readJson(join(workspaceRoot, 'packages', directory, 'package.json'))
  for (const required of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
    if (!existsSync(join(workspaceRoot, 'packages', directory, required))) {
      throw new Error(`${name} is not built: missing ${required}; run the workspace build before packing`)
    }
  }
  const result = spawnPnpmSync([
    '--filter', name, 'pack', '--pack-destination', staging,
  ], { cwd: workspaceRoot, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`packing ${name} exited with ${String(result.status)}`)
  const filename = expectedTarballName(name, sourceManifest.version)
  const tarball = join(staging, filename)
  if (!existsSync(tarball)) throw new Error(`${name} produced no tarball at ${tarball}`)
  const manifest = readPackedManifest(tarball)
  if (manifest.name !== name || manifest.version !== sourceManifest.version) {
    throw new Error(`${filename} identity does not match ${name}@${sourceManifest.version}`)
  }
  const entries = new Set(readPackedEntries(tarball))
  for (const required of ['package/lib/index.js', 'package/lib/client.js', 'package/cordis.patch.yml']) {
    if (!entries.has(required)) throw new Error(`${filename} is missing ${required}`)
  }
  const data = readFileSync(tarball)
  packed.push({ name, version: manifest.version, file: filename, sha256: createHash('sha256').update(data).digest('hex') })
}

for (const entry of packed) copyFileSync(join(staging, entry.file), join(vendorRoot, entry.file))
rmSync(staging, { recursive: true, force: true })
writeFileSync(join(vendorRoot, 'manifest.json'), `${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  packages: packed,
}, null, 2)}\n`, 'utf8')
console.log(`Packed ${packed.length} TRS AIP plugins to ${vendorRoot}`)

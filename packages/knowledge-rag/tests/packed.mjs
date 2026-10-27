import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, realpath, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// npm pack must run first. This test never downloads or installs dependencies.
const packageRoot = resolve('.test-data/installed/node_modules/@trs-aip/dsh-knowledge-rag')
await mkdir(packageRoot, { recursive: true })
const extracted = spawnSync('tar', ['-xzf', '.test-data/trs-aip-dsh-knowledge-rag-0.1.0.tgz', '-C', packageRoot, '--strip-components=1'], { encoding: 'utf8' })
assert.equal(extracted.status, 0, extracted.stderr)
const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
assert.equal(packageJson.name, '@trs-aip/dsh-knowledge-rag')
for (const dependency of Object.keys({ ...packageJson.peerDependencies, ...packageJson.dependencies })) {
  const target = join(packageRoot, 'node_modules', dependency)
  await mkdir(join(target, '..'), { recursive: true })
  try { await symlink(await realpath(join('node_modules', dependency)), target, process.platform === 'win32' ? 'junction' : 'dir') }
  catch (e) { if (e.code !== 'EEXIST') throw e }
}
assert.ok((await readdir(join(packageRoot, 'lib'))).includes('worker.js'))
const result = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'tests/client.test.ts', 'tests/integration.test.ts', 'tests/parsers.test.ts'], { stdio: 'inherit', env: { ...process.env, RAG_TEST_ENTRY: pathToFileURL(join(packageRoot, 'lib/index.js')).href } })
assert.equal(result.status, 0, 'installed tarball failed integration or Worker parsing')
console.log('Installed tarball OK: Loader, native lock, retrieval, rebuild and all parser formats')

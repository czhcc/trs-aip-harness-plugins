import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const files = await readdir('lib')
for (const name of ['index.js', 'client.js', 'worker.js']) assert.ok(files.includes(name), `missing ${name}`)
const allowed = new Set(['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'])
const client = await readFile('lib/client.js', 'utf8')
for (const match of client.matchAll(/\brequire\(["']([^"']+)["']\)/g)) assert.ok(allowed.has(match[1]), `browser dependency was not bundled: ${match[1]}`)
assert.ok(client.includes('window.__ModuleLoader__.load'))
for (const file of files.filter(name => name.endsWith('.js') && name !== 'client.js')) {
  const source = await readFile(resolve('lib', file), 'utf8')
  for (const match of source.matchAll(/(?:from\s*|import\s*\()["']\.\/([^"']+)["']/g)) {
    assert.ok(files.includes(match[1]), `${file} references missing ${match[1]}`)
  }
}
console.log('Host, browser factory, Worker and dynamic parser chunks are complete')

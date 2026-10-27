import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { Config, createDefaultStdioServer } from '../packages/mcp-settings/lib/index.js'
import { evaluatePluginCompatibility } from '../../deepseek-harness/packages/boot/app-boot/lib/index.js'

const root = resolve(import.meta.dirname, '..')
const harnessVersion = JSON.parse(readFileSync(resolve(root, '../deepseek-harness/package.json'), 'utf8')).version
const require = createRequire(resolve(root, 'packages/mcp-settings/package.json'))
const Schema = require('@deepseek-ai/schemastery')

test('new plugin packages pass the actual DSH compatibility gate', () => {
  for (const directory of ['client-branding', 'mcp-settings', 'theme-manager']) {
    const manifest = JSON.parse(readFileSync(resolve(root, 'packages', directory, 'package.json'), 'utf8'))
    assert.equal(evaluatePluginCompatibility(manifest, {}, harnessVersion), undefined)
    const oldPeers = Object.fromEntries(Object.keys(manifest.peerDependencies)
      .filter(name => name.startsWith('@deepseek-ai/dsh-')).map(name => [name, '0.2.1-alpha.1']))
    assert.ok(evaluatePluginCompatibility({ ...manifest, version: '0.1.2', peerDependencies: oldPeers }, {}, harnessVersion))
  }
})

test('MCP Config exposes volatile defaults and a serializable browser form', () => {
  const result = Config['~standard'].validate({})
  assert.deepEqual(result.value.servers.get(), [])
  assert.equal(Config.dict.servers.meta.volatile, true)
  const wire = JSON.parse(JSON.stringify(Config.toJSON()))
  const formSchema = new Schema(wire)
  delete formSchema.dict.servers.meta.volatile
  assert.deepEqual(formSchema({ servers: [] }), { servers: [] })
})

test('MCP Host rejects invalid and duplicate servers before persistence', () => {
  const server = { ...createDefaultStdioServer('server1', 'server1'), command: 'node' }
  assert.equal(Config['~standard'].validate({ servers: [server] }).issues, undefined)
  assert.ok(Config['~standard'].validate({ servers: [server, server] }).issues)
  assert.ok(Config['~standard'].validate({ servers: [{ ...server, command: '' }] }).issues)
})

test('MCP browser activation uses configForms and releases its registrations', async () => {
  let plugin
  runInNewContext(readFileSync(resolve(root, 'packages/mcp-settings/lib/client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load: entry => { plugin = entry.factory(() => ({})) } } },
  })
  let formNamespace
  let uiDisposed = false
  let remoteDisposed = false
  const ctx = {
    remote: { $mount: async () => async () => { remoteDisposed = true } },
    configForms: { get: ns => { formNamespace = ns; return {} } },
    slots: { inject: (_slot, callback) => callback(), register: () => {} },
    inject: (services, callback) => {
      assert.ok(services.includes('configForms'))
      callback(ctx)
      const ready = Promise.resolve()
      ready.dispose = async () => { uiDisposed = true }
      return ready
    },
  }
  const dispose = await plugin.apply(ctx)
  assert.equal(formNamespace, 'trs-aip-mcp-settings')
  await dispose()
  assert.ok(uiDisposed && remoteDisposed)
})

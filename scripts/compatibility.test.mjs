import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { Config, McpCoordinator, createDefaultStdioServer } from '../packages/mcp-settings/lib/index.js'
import { evaluatePluginCompatibility } from '../../deepseek-harness/packages/boot/app-boot/lib/index.js'

const root = resolve(import.meta.dirname, '..')
const harnessVersion = JSON.parse(readFileSync(resolve(root, '../deepseek-harness/package.json'), 'utf8')).version
const require = createRequire(resolve(root, 'packages/mcp-settings/package.json'))
const Schema = require('@deepseek-ai/schemastery')

test('new plugin packages pass the actual DSH compatibility gate', () => {
  for (const directory of ['client-branding', 'mcp-settings', 'theme-manager', 'knowledge-rag']) {
    const manifest = JSON.parse(readFileSync(resolve(root, 'packages', directory, 'package.json'), 'utf8'))
    assert.equal(evaluatePluginCompatibility(manifest, {}, harnessVersion), undefined)
    const oldPeers = Object.fromEntries(Object.keys(manifest.peerDependencies)
      .filter(name => name.startsWith('@deepseek-ai/dsh-')).map(name => [name, '0.2.2-alpha.3']))
    assert.ok(evaluatePluginCompatibility({ ...manifest, version: directory === 'knowledge-rag' ? '0.1.1' : '0.1.4', peerDependencies: oldPeers }, {}, harnessVersion))
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

test('MCP coordinator supplies current transport defaults and preserves literals', async () => {
  const configs = []
  const ctx = {
    plugin: (_plugin, config) => {
      configs.push(config)
      const fiber = Promise.resolve()
      fiber.dispose = async () => {}
      return fiber
    },
    credentials: { resolve: async () => ({ value: 'resolved-secret' }) },
    logger: { info() {}, warn: message => assert.fail(message), error: message => assert.fail(message) },
  }
  const status = { configure() {}, setPhase() {}, refreshTools() {}, markStopped() {} }
  const coordinator = new McpCoordinator(ctx, status)
  const stdio = {
    ...createDefaultStdioServer('stdio', 'stdio'), enabled: true, command: 'node',
    envLiterals: { LITERAL: '${credential:leave-as-is}' },
    envCredentialRefs: { SECRET: 'secret_ref' },
  }
  const http = {
    id: 'http', serverName: 'http', enabled: true, transport: 'streamable-http',
    url: 'http://localhost:3000/mcp', toolCallTimeoutMs: 60000,
    failOnStartupError: false, reconnect: stdio.reconnect,
    headerLiterals: { LITERAL: '${credential:leave-as-is}' },
    headerCredentialRefs: { SECRET: 'secret_ref' },
  }
  try {
    await coordinator.update({ servers: [stdio, http] })
    assert.equal(configs.length, 2)
    for (const config of configs) {
      assert.equal(config.closeTimeoutMs, 5000)
      assert.equal(config.expandTemplates, false)
      assert.deepEqual(config.transport === 'stdio' ? config.env : config.headers, {
        LITERAL: '${credential:leave-as-is}', SECRET: 'resolved-secret',
      })
    }
  } finally {
    await coordinator.dispose()
  }
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

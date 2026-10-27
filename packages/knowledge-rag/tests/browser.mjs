import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const esbuild = createRequire(require.resolve('tsx'))('esbuild')
const artifacts = join(process.cwd(), '.test-data/browser')
await mkdir(artifacts, { recursive: true })
const reactDir = dirname(require.resolve('react/package.json'))
const rendererRequire = createRequire(require.resolve('@deepseek-ai/dsh-client-ui-renderer'))
const domDir = dirname(rendererRequire.resolve('react-dom/package.json'))
await esbuild.build({ entryPoints: ['tests/browser-fixture.tsx'], outfile: join(artifacts, 'fixture.js'), bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic', alias: { react: reactDir, 'react-dom': domDir }, logLevel: 'warning' })
const theme = await readFile(join(dirname(require.resolve('@deepseek-ai/dsh-client-ui-renderer/package.json')), '../ui-theme/src/styles/design-platform.css'))
const server = createServer(async (req, res) => {
  try {
    const url = req.url?.split('?')[0]
    if (url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><html><head><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;font:14px system-ui;height:100vh}#root{box-sizing:border-box;width:460px;height:100vh;margin-left:auto;border-left:1px solid gray}.expanded #root{width:100%}</style></head><body><main id="root"></main><script type="module" src="/fixture.js"></script></body></html>'); return }
    if (url === '/theme.css') { res.setHeader('Content-Type', 'text/css'); res.end(theme); return }
    const paths = { '/fixture.js': join(artifacts, 'fixture.js'), '/fixture.css': join(artifacts, 'fixture.css'), '/client.js': 'lib/client.js', '/fixture.json': '.test-data/ui-fixture.json' }
    if (!(url in paths)) { res.writeHead(404).end(); return }
    res.setHeader('Content-Type', url.endsWith('.css') ? 'text/css' : url.endsWith('.json') ? 'application/json' : 'text/javascript')
    res.end(await readFile(paths[url]))
  } catch (e) { res.writeHead(500).end(String(e)) }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
let browser, page
try {
  browser = await chromium.launch({ headless: true, ...(process.env.RAG_BROWSER_CHANNEL ? { channel: process.env.RAG_BROWSER_CHANNEL } : {}) })
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = [], network = []
  page.on('pageerror', e => { errors.push(e.message); console.error(e.stack) }); page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1')) network.push(r.url()) })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('heading', { name: '文档', exact: true }).waitFor()
  // The blank-session Hero and active-session header use the same durable switch.
  await page.evaluate(() => window.showSessionSwitch(true))
  const mode = page.getByRole('button', { name: '知识库：关闭', exact: true })
  await mode.click()
  await page.getByRole('button', { name: '知识库：自动使用', exact: true }).waitFor()
  await page.screenshot({ path: join(artifacts, 'new-session-switch.png') })
  await page.evaluate(() => window.showSessionSwitch(false))
  await page.getByRole('button', { name: '知识库：自动使用', exact: true }).waitFor()
  await page.evaluate(() => window.showSessionSwitch(true, 'session-b'))
  await mode.waitFor()
  assert.equal(await mode.getAttribute('aria-pressed'), 'false')
  await page.evaluate(() => window.showSessionSwitch(true))
  await page.getByRole('button', { name: '知识库：自动使用', exact: true }).click()
  await mode.waitFor()
  await page.evaluate(() => window.showPanel())
  await page.getByRole('heading', { name: '文档', exact: true }).waitFor()
  assert.equal(await page.getByRole('tab').count(), 4)
  await page.getByRole('button', { name: '查看', exact: true }).click()
  await page.getByRole('button', { name: '解析预览', exact: true }).click()
  await page.getByText('"chunkCount": 1', { exact: false }).waitFor()
  await page.getByRole('tab', { name: '检索预览' }).click()
  await page.getByLabel('查询', { exact: true }).fill('Alpha theme state')
  await page.getByRole('button', { name: '生成回答', exact: true }).click()
  await page.locator('article strong').filter({ hasText: 'Alpha' }).waitFor()
  assert.equal(await page.evaluate(() => window.unsafe), undefined)
  const colors = new Set()
  for (const skin of ['original', 'china-police']) for (const dark of [false, true]) {
    const before = await page.evaluate(() => window.requests.filter(a => a === 'query.answer' || a === 'query.preview').length)
    await page.evaluate(({ skin, dark }) => { document.body.toggleAttribute('data-dsh-china-police', skin === 'china-police'); document.body.toggleAttribute('data-ds-dark-theme', dark) }, { skin, dark })
    assert.equal(await page.getByLabel('查询', { exact: true }).inputValue(), 'Alpha theme state')
    assert.equal(await page.evaluate(() => window.requests.filter(a => a === 'query.answer' || a === 'query.preview').length), before)
    colors.add(await page.locator('.trs-rag').evaluate(el => `${getComputedStyle(el).color}/${getComputedStyle(el).backgroundColor}`))
    await page.screenshot({ path: join(artifacts, `${skin}-${dark ? 'dark' : 'light'}.png`) })
  }
  assert.equal(colors.size, 4)
  await page.getByText('knowledge.txt', { exact: false }).first().click()
  await page.getByRole('button', { name: '查看来源文档' }).first().click()
  await page.getByRole('heading', { name: '文档', exact: true }).waitFor()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('dialog', { name: '知识库操作确认' }).waitFor()
  await page.screenshot({ path: join(artifacts, 'confirmation.png') })
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('dialog').count(), 0)
  assert.equal(await page.evaluate(() => window.requests.filter(a => a === 'graph.browse').length), 0, 'hidden graph must not load before it is opened')
  await page.getByRole('tab', { name: '知识图谱' }).click()
  await page.locator('svg circle').first().waitFor()
  assert.ok(await page.locator('svg circle').count() >= 1)
  await page.screenshot({ path: join(artifacts, 'graph-initial.png') })
  await page.getByRole('button', { name: '清空图谱', exact: true }).click()
  assert.equal(await page.locator('svg circle').count(), 0)
  await page.getByRole('button', { name: '刷新图谱', exact: true }).click()
  await page.locator('svg circle').first().waitFor()
  await page.evaluate(() => window.emptyGraph(true))
  await page.getByRole('button', { name: '清空图谱', exact: true }).click()
  await page.getByRole('button', { name: '刷新图谱', exact: true }).click()
  await page.getByText('当前索引尚无实体', { exact: false }).waitFor()
  await page.evaluate(() => window.emptyGraph(false))
  await page.getByRole('tab', { name: '文档', exact: true }).click()
  await page.getByRole('tab', { name: '知识图谱' }).click()
  await page.locator('svg circle').first().waitFor()
  await page.getByRole('button', { name: '展开 / 收起' }).click()
  assert.equal(await page.locator('#root').evaluate(el => el.getBoundingClientRect().width), 1280)
  await page.evaluate(() => window.showSettings())
  await page.getByRole('heading', { name: '知识库模型设置' }).waitFor()
  const model = page.getByLabel('知识库文本模型', { exact: true })
  await model.selectOption(JSON.stringify(['other', 'text-b']))
  await page.screenshot({ path: join(artifacts, 'text-model-settings.png') })
  await page.getByLabel('向量维度').fill('512')
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.getByRole('status').waitFor()
  assert.deepEqual(await page.evaluate(() => window.settingsSnapshot().value.text), { provider: 'other', model: 'text-b' })
  await page.screenshot({ path: join(artifacts, 'settings.png') })
  await page.evaluate(() => window.showPanel())
  await page.getByRole('tab', { name: '文档' }).waitFor()
  await page.evaluate(() => window.showSettings())
  await page.waitForFunction(() => document.querySelector('[aria-label="知识库文本模型"]')?.value === JSON.stringify(['other', 'text-b']))
  await page.evaluate(() => window.failCatalog(true))
  await page.getByRole('button', { name: '刷新模型列表' }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await model.inputValue(), JSON.stringify(['other', 'text-b']))
  await model.selectOption('')
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.waitForFunction(() => window.settingsSnapshot().value.text.provider === '')
  await page.evaluate(() => window.dispose())
  assert.equal(await page.locator('style[data-plugin]').count(), 0)
  assert.deepEqual(errors, [])
  assert.deepEqual(network, [])
  console.log('Browser OK: built factory, four tabs, parsed preview, safe Markdown, source navigation, graph, expansion, settings, four live themes, cleanup')
} catch (e) {
  if (page) { await page.screenshot({ path: join(artifacts, 'failure.png') }); await import('node:fs/promises').then(fs => page.content().then(content => fs.writeFile(join(artifacts, 'failure.html'), content))) }
  throw e
} finally { await browser?.close(); await new Promise(r => server.close(r)) }

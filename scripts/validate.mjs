import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const readJson = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'))
const readText = async path => await readFile(resolve(root, path), 'utf8')

const client = await readJson('packages/client-branding/package.json')
const patch = await readText('packages/client-branding/cordis.patch.yml')
const source = await readText('packages/client-branding/src/client/index.ts')
const brand = await readText('packages/client-branding/src/client/Brand.tsx')
const build = await readText('build/dsh-client.ts')
const mcp = await readJson('packages/mcp-settings/package.json')
const mcpPatch = await readText('packages/mcp-settings/cordis.patch.yml')
const mcpHost = await readText('packages/mcp-settings/src/index.ts')
const mcpModel = await readText('packages/mcp-settings/src/model.ts')
const mcpClient = await readText('packages/mcp-settings/src/client/index.ts')
const mcpSection = await readText('packages/mcp-settings/src/client/McpSettingsSection.tsx')

const failures = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
}

check(client.name === '@trs-aip/dsh-client-branding', 'Client 包名不正确')
check(client.exports?.['./client']?.default === './lib/client.js', 'Client 导出必须指向 lib/client.js')
check(client.dsh?.client?.platform === 'web', 'Client 清单必须声明 web 平台')

const manifestInject = new Set(client.dsh?.client?.inject ?? [])
for (const dependency of [
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-sidebar',
  '@deepseek-ai/dsh-client-ui-theme',
]) {
  check(manifestInject.has(dependency), `缺少 dsh.client.inject 依赖：${dependency}`)
}

for (const [dependency, specifier] of Object.entries(client.devDependencies ?? {})) {
  if (!dependency.startsWith('@deepseek-ai/')) continue
  check(
    specifier.startsWith('link:../../../deepseek-harness/'),
    `DSH 开发依赖必须链接同级工程：${dependency}`,
  )
}

check(client.dsh?.bundle?.patch === './cordis.patch.yml', 'Bundle 清单必须暴露 cordis.patch.yml')
check(/id:\s*ui-brand-official[\s\S]*?disabled:\s*true/.test(patch), 'Bundle 必须禁用 ui-brand-official')
check(/name:\s*['"]?@trs-aip\/dsh-client-branding['"]?/.test(patch), 'Bundle 必须插入 Client 包')

for (const slot of [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
]) {
  check(source.includes(slot), `Client apply 缺少插槽：${slot}`)
}
check(source.includes('overrideTokens(THEME_SOURCE'), 'Client apply 必须安装主题令牌覆盖层')
check(brand.includes('TRS-AIP'), '品牌组件必须包含 TRS-AIP 标识')
check(brand.includes("const HERO_HEADLINE = '驱动智能探索图谱'"), '品牌组件必须覆盖新建对话标题')
check(brand.includes('useTrsAipHeroHeadline(size === 34)'), '标题覆盖必须仅作用于 34 px Hero 品牌标记')
check(brand.includes('[data-slot="conversation.hero.brand.mark"]'), '标题覆盖必须通过 Hero slot 锚点定位')
check(build.includes('window.__ModuleLoader__.load'), 'Client 构建产物必须注册到 DSH 模块加载器')

check(mcp.name === '@trs-aip/dsh-mcp-settings', 'MCP 包名不正确')
check(mcp.exports?.['./client']?.default === './lib/client.js', 'MCP Client 导出必须指向 lib/client.js')
check(mcp.dsh?.bundle?.patch === './cordis.patch.yml', 'MCP Bundle 清单必须暴露 cordis.patch.yml')
check(mcp.dsh?.client?.platform === 'web', 'MCP Client 清单必须声明 web 平台')
check(/name:\s*['"]?@trs-aip\/dsh-mcp-settings['"]?/.test(mcpPatch), 'MCP Bundle 必须插入自身插件')
check(mcpModel.includes("MCP_SETTINGS_NAMESPACE = 'trs-aip-mcp'"), 'MCP 设置命名空间不正确')
check(mcpModel.includes('validateMcpSettings'), 'MCP 配置必须提供跨字段和唯一性校验')
check(mcpHost.includes('settings.register(MCP_SETTINGS_NAMESPACE'), '宿主端必须注册 MCP 设置命名空间')
check(mcpHost.includes('new McpCoordinator'), '宿主端必须安装 MCP 实例协调器')
check(mcpHost.includes("credentials/reference-updated"), '凭据更新必须触发相关 MCP 实例刷新')
check(mcpHost.includes('this.ctx.plugin(McpClient, config)'), '协调器必须动态挂载 dsh-mcp-client')
check(mcpClient.includes("name: 'settings.section'"), '浏览器端必须注册独立设置页面')
for (const capability of ['添加客户端', 'streamable-http', 'envCredentialRefs', 'headerCredentialRefs', 'scope.mutate']) {
  check(mcpSection.includes(capability), `MCP 设置页面缺少能力：${capability}`)
}

if (failures.length > 0) {
  console.error(`校验失败：\n- ${failures.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log('校验通过：品牌插件 + MCP 设置命名空间、动态协调器、双传输设置页和 DSH 模块工厂')
}

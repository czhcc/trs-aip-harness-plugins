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
const mcpStatus = await readText('packages/mcp-settings/src/status.ts')
const mcpStatusRemote = await readText('packages/mcp-settings/src/status-remote.ts')
const themeManager = await readJson('packages/theme-manager/package.json')
const themeManagerPatch = await readText('packages/theme-manager/cordis.patch.yml')
const themeManagerHost = await readText('packages/theme-manager/src/index.ts')
const themeManagerClient = await readText('packages/theme-manager/src/client/ThemeManager.tsx')
const policeTheme = await readJson('packages/skin-china-police/package.json')
const policeManifest = await readJson('packages/skin-china-police/skin.json')
const policePatch = await readText('packages/skin-china-police/cordis.patch.yml')
const policeClient = await readText('packages/skin-china-police/src/client/index.ts')
const policeStyles = await readText('packages/skin-china-police/src/client/styles.ts')

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
check(build.includes("entry: { index: 'lib/types/index.js' }"), 'Host 构建必须消费 TypeScript 产物以转译 Remote 装饰器')

check(mcp.name === '@trs-aip/dsh-mcp-settings', 'MCP 包名不正确')
check(mcp.exports?.['./client']?.default === './lib/client.js', 'MCP Client 导出必须指向 lib/client.js')
check(mcp.dsh?.bundle?.patch === './cordis.patch.yml', 'MCP Bundle 清单必须暴露 cordis.patch.yml')
check(mcp.dsh?.client?.platform === 'web', 'MCP Client 清单必须声明 web 平台')
check(mcp.scripts?.build?.includes('node --check lib/index.js'), 'MCP 构建必须检查 Host 产物可被 Node 解析')
check(mcp.dsh?.client?.inject?.includes('@deepseek-ai/dsh-api-remotes'), 'MCP Client 必须注入凭据 Remote 外观')
check(/name:\s*['"]?@trs-aip\/dsh-mcp-settings['"]?/.test(mcpPatch), 'MCP Bundle 必须插入自身插件')
check(mcpModel.includes("MCP_SETTINGS_NAMESPACE = 'trs-aip-mcp'"), 'MCP 设置命名空间不正确')
check(mcpModel.includes('validateMcpSettings'), 'MCP 配置必须提供跨字段和唯一性校验')
check(mcpHost.includes('settings.register(MCP_SETTINGS_NAMESPACE'), '宿主端必须注册 MCP 设置命名空间')
check(mcpHost.includes('new McpCoordinator'), '宿主端必须安装 MCP 实例协调器')
check(mcpHost.includes("credentials/reference-updated"), '凭据更新必须触发相关 MCP 实例刷新')
check(mcpHost.includes('this.ctx.plugin(McpClient, config)'), '协调器必须动态挂载 dsh-mcp-client')
check(mcpHost.includes('new McpStatusController'), '宿主端必须安装 MCP 只读状态服务')
check(/@Remote\s+snapshot\(\)/.test(mcpHost), 'MCP 状态 snapshot 必须标记为 Host Remote 路由')
check(mcpHost.includes("runtimeCtx.on('tools/change'"), '工具注册变化必须刷新 MCP 工具数量')
check(mcpStatus.includes("'activation-failed'"), 'MCP 状态目录必须保留实例激活失败状态')
check(mcpStatus.includes("'restarting'"), 'MCP 状态目录必须区分实例重新启动状态')
check(mcpStatusRemote.includes("result: { mode: 'src-json' }"), 'MCP 状态 Remote 必须使用 JSON 边界结果')
check(mcpClient.includes("name: 'settings.section'"), '浏览器端必须注册独立设置页面')
check(mcpClient.includes('ctx.remote.$mount(MCP_STATUS_REMOTE)'), '浏览器端必须挂载 MCP 状态 Remote')
check(mcpClient.includes("'remote.trsAipMcp'"), 'MCP 设置 UI 必须显式注入动态状态 Remote namespace')
check(mcpClient.includes('ctx.remote.credentials.set'), '浏览器端凭据值必须通过凭据 Remote 写入')
for (const capability of [
  '添加客户端',
  'streamable-http',
  'envCredentialRefs',
  'headerCredentialRefs',
  'scope.mutate',
  '复制',
  '导入 JSON',
  '导出 JSON',
  'window.confirm',
  '已发现 ${status.toolCount} 个工具',
]) {
  check(mcpSection.includes(capability), `MCP 设置页面缺少能力：${capability}`)
}

check(themeManager.name === '@trs-aip/dsh-theme-manager', '主题管理器包名不正确')
check(themeManager.exports?.['./client']?.default === './lib/client.js', '主题管理器 Client 导出必须指向 lib/client.js')
check(themeManager.dsh?.client?.inject?.includes('@deepseek-ai/dsh-client-ui-settings'), '主题管理器必须注入设置页模块')
check(/name:\s*['"]?@trs-aip\/dsh-theme-manager['"]?/.test(themeManagerPatch), 'Bundle 必须插入主题管理器')
check(themeManagerHost.includes('discoverInstalledThemes'), '主题管理器必须通过 skin.json 发现主题')
check(themeManagerHost.includes("target !== 'official'"), '主题管理器必须支持恢复原版主题')
check(themeManagerHost.includes('hasLegacyBrandOverrides'), '主题管理器必须迁移早期版本遗留的品牌覆盖行')
check(!themeManagerHost.includes('const TRS_BRAND_ID') && !themeManagerHost.includes('const OFFICIAL_BRAND_ID'), '主题管理器不得接管品牌插件状态')
check(!themeManagerHost.includes('GitHub') && !themeManagerHost.includes('version'), '主题管理器不得包含版本或远端更新检查')
check(themeManagerClient.includes('DeepSeek Harness 原版'), '主题设置页必须提供原版主题选项')
check(themeManagerClient.includes('保留当前品牌与 Logo 插件'), '原版主题说明必须明确保留独立品牌插件')

check(policeTheme.name === '@trs-aip/dsh-skin-china-police', '中国警察主题包名不正确')
check(policeTheme.exports?.['./skin.json'] === './skin.json', '中国警察主题必须导出 skin.json')
check(policeManifest.id === 'china-police', '中国警察主题 id 不正确')
check(policeManifest.bodyAttr === 'data-dsh-china-police', '中国警察主题 body 属性不正确')
check(policeManifest.wiring?.id === 'trs-aip-skin-china-police', '中国警察主题 wiring id 不正确')
check(/name:\s*['"]?@trs-aip\/dsh-skin-china-police['"]?/.test(policePatch), 'Bundle 必须插入中国警察主题')
check(policeClient.includes('china-police-light.png?inline'), '中国警察主题必须内嵌浅色背景素材')
check(policeClient.includes('china-police-dark.png?inline'), '中国警察主题必须内嵌深色背景素材')
check(policeClient.includes('data-china-police-owner'), '中国警察主题必须按实例回收 DOM')
check(policeStyles.includes('body[data-dsh-china-police][data-ds-dark-theme]'), '中国警察主题必须适配深色模式')

if (failures.length > 0) {
  console.error(`校验失败：\n- ${failures.join('\n- ')}`)
  process.exitCode = 1
} else {
  console.log('校验通过：品牌插件、MCP 设置、主题管理器与中国警察主题')
}

import { defineConfig } from 'tsdown'
import { readFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'

/** 这些模块由 DSH Web Client 模块表提供，不打包进插件。 */
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-renderer',
])

const INLINE_ASSET_PREFIX = '\0trs-aip-inline-asset:'
const INLINE_ASSET_MIME = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
])

/** 将显式标记为 ?inline 的本地位图转为 data URI，避免插件依赖静态资源路由。 */
function inlineAssetPlugin() {
  const assets = new Map<string, { mime: string, path: string }>()
  const idsByPath = new Map<string, string>()
  return {
    name: 'trs-aip-inline-raster-assets',
    resolveId(source: string, importer: string | undefined) {
      if (importer === undefined || !source.endsWith('?inline')) return null
      const request = source.slice(0, -'?inline'.length)
      const mime = INLINE_ASSET_MIME.get(extname(request).toLowerCase())
      if (mime === undefined) return null
      const path = resolve(dirname(importer), request)
      const known = idsByPath.get(path)
      if (known !== undefined) return known
      const id = `${INLINE_ASSET_PREFIX}${assets.size}${extname(request).toLowerCase()}`
      idsByPath.set(path, id)
      assets.set(id, { mime, path })
      return id
    },
    async load(id: string) {
      if (!id.startsWith(INLINE_ASSET_PREFIX)) return null
      const asset = assets.get(id)
      if (asset === undefined) throw new Error(`invalid inline asset id: ${id}`)
      const { mime, path } = asset
      this.addWatchFile(path)
      const encoded = (await readFile(path)).toString('base64')
      return `export default ${JSON.stringify(`data:${mime};base64,${encoded}`)}`
    },
  }
}

/**
 * 构建独立的 DSH Client 插件：Node 端保留空入口，浏览器端工厂注册到
 * Web Client 模块表。该配置不依赖构建时解析同级 deepseek-harness 工程。
 */
export function dshClientPlugin(packageName: string) {
  return defineConfig([
    {
      name: `${packageName}/host`,
      // Consume TypeScript's emitted JavaScript, matching the Harness build.
      // This is required for standard decorators such as @Remote to be lowered
      // before Rolldown bundles the Host entry.
      entry: { index: 'lib/types/index.js' },
      outDir: 'lib',
      format: ['esm'],
      platform: 'node',
      target: 'es2024',
      fixedExtension: false,
      dts: false,
      clean: false,
      sourcemap: true,
    },
    {
      name: `${packageName}/client`,
      entry: { client: 'src/client/index.ts' },
      outDir: 'lib',
      format: ['cjs'],
      platform: 'browser',
      target: 'es2024',
      fixedExtension: false,
      dts: false,
      clean: false,
      sourcemap: true,
      deps: {
        neverBundle: specifier => CLIENT_EXTERNALS.has(specifier),
      },
      plugins: [inlineAssetPlugin()],
      outputOptions: {
        entryFileNames: 'client.js',
        sourcemapExcludeSources: false,
        banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}, factory: (require) => {`,
        footer: 'return module.exports; } });',
        intro: 'var module = { exports: {} }; var exports = module.exports;',
      },
    },
  ])
}

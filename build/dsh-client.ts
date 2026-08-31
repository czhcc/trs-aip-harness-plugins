import { defineConfig } from 'tsdown'

/** 这些模块由 DSH Web Client 模块表提供，不打包进插件。 */
const CLIENT_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
])

/**
 * 构建独立的 DSH Client 插件：Node 端保留空入口，浏览器端工厂注册到
 * Web Client 模块表。该配置不依赖构建时解析同级 deepseek-harness 工程。
 */
export function dshClientPlugin(packageName: string) {
  return defineConfig([
    {
      name: `${packageName}/host`,
      entry: { index: 'src/index.ts' },
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


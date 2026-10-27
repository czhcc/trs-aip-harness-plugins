import { defineConfig } from 'tsdown'
import { dshClientPlugin } from '../../build/dsh-client.ts'
const base = dshClientPlugin('@trs-aip/dsh-knowledge-rag')
base[1]!.deps = { ...base[1]!.deps, alwaysBundle: id => !id.startsWith('@deepseek-ai/') && !/^react(?:$|\/)/.test(id), onlyBundle: false }
// tsdown defaults CJS to Node even when it is a DSH browser factory.
base[1]!.inputOptions = options => ({ ...options, platform: 'browser', resolve: { ...options.resolve, conditionNames: ['browser', 'import', 'default'] } })
export default defineConfig([...base, { entry: { 'worker': 'lib/types/engine/parsers/worker.js' }, outDir: 'lib', platform: 'node', format: ['esm'], target: 'es2024', clean: false, dts: false, fixedExtension: false }])

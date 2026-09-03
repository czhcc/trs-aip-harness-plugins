import assert from 'node:assert/strict'
import { readThemeStates, switchPatch } from '../packages/theme-manager/lib/index.js'

const catalog = [
  {
    id: 'china-police',
    name: '中国警察',
    package: '@trs-aip/dsh-skin-china-police',
    wiringId: 'trs-aip-skin-china-police',
    bodyAttr: 'data-dsh-china-police',
    order: 10,
  },
  {
    id: 'second-theme',
    name: '第二主题',
    package: '@example/second-theme',
    wiringId: 'example-second-theme',
    bodyAttr: 'data-example-second-theme',
    order: 20,
  },
]

const userPatch = '# user config\n- id: keep-me\n  disabled: false\n'
const themed = switchPatch(userPatch, 'china-police', catalog)
assert.match(themed, /- id: trs-aip-skin-china-police\n  disabled: false/)
assert.match(themed, /- id: example-second-theme\n  disabled: true/)
assert.doesNotMatch(themed, /- id: trs-aip-client-branding/)
assert.doesNotMatch(themed, /- id: ui-brand-official/)
assert.match(themed, /- id: keep-me/)

const official = switchPatch(themed, 'official', catalog)
assert.equal((official.match(/# --- trs-aip theme managed \(auto-generated; do not edit\) ---/g) ?? []).length, 1)
assert.equal(readThemeStates(official, catalog).get('trs-aip-skin-china-police'), true)
assert.equal(readThemeStates(official, catalog).get('example-second-theme'), true)

const legacy = `${themed.replace(
  '# --- end trs-aip theme managed ---',
  '- id: trs-aip-client-branding\n  disabled: true\n- id: ui-brand-official\n  disabled: false\n# --- end trs-aip theme managed ---',
)}`
const migrated = switchPatch(legacy, 'china-police', catalog)
assert.doesNotMatch(migrated, /- id: trs-aip-client-branding/)
assert.doesNotMatch(migrated, /- id: ui-brand-official/)

console.log('主题切换契约校验通过')

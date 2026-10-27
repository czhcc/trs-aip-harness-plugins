import { createRequire } from 'node:module'
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const records = new Map()
async function visit(name, parent) {
  const require = createRequire(parent)
  let root
  for (const search of require.resolve.paths(name) ?? []) {
    try { root = await realpath(join(search, name)); await readFile(join(root, 'package.json')); break } catch { root = undefined }
  }
  if (!root) throw new Error(`Cannot inspect bundled dependency ${name}`)
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const id = `${pkg.name}@${pkg.version}`
  if (records.has(id)) return
  const notices = []
  for (const file of await readdir(root, { withFileTypes: true })) {
    if (!file.isFile() || !/^(licen[cs]e|notice|copying)(\.|$)/i.test(file.name)) continue
    const data = await readFile(join(root, file.name))
    notices.push({ file: file.name, sha256: createHash('sha256').update(data).digest('hex'), text: data.toString('utf8') })
  }
  if (!notices.length) throw new Error(`Bundled dependency ${id} has no license text`)
  records.set(id, { name: pkg.name, version: pkg.version, license: pkg.license, notices })
  for (const dependency of Object.keys(pkg.dependencies ?? {})) await visit(dependency, join(root, 'package.json'))
}
for (const name of ['zod', 'react-markdown']) await visit(name, import.meta.url)
const sorted = [...records.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))
await writeFile('third_party/browser-dependencies.json', JSON.stringify(sorted.map(({ notices, ...pkg }) => ({ ...pkg, notices: notices.map(({ text, ...notice }) => notice) })), null, 2) + '\n')
await writeFile('third_party/BROWSER_THIRD_PARTY_NOTICES.txt', sorted.map(pkg => `=== ${pkg.name}@${pkg.version} (${pkg.license}) ===\n\n${pkg.notices.map(n => `${n.file}\n\n${n.text}`).join('\n\n')}`).join('\n\n'))
console.log(`Retained license texts for ${sorted.length} browser dependencies`)

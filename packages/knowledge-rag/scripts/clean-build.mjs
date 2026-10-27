import { rm } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const output = join(root, 'lib')
if (relative(root, output) !== 'lib') throw new Error('Refusing to clean outside the plugin output directory')
await rm(output, { recursive: true, force: true })

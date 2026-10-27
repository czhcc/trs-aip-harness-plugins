import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { parseDocument } = await import(process.env.RAG_TEST_ENTRY ? new URL('./types/engine/parsers/index.js', process.env.RAG_TEST_ENTRY).href : new URL('../lib/types/engine/parsers/index.js', import.meta.url).href)

test('published Worker resolves text, PDF and Office parsers and rejects scanned/encrypted PDF', { timeout: 60000 }, async () => {
  for (const extension of ['txt', 'md', 'json', 'html', 'csv', 'pdf', 'docx', 'pptx', 'xlsx']) {
    const name = `sample.${extension}`
    const parsed = await parseDocument(await readFile(new URL(`fixtures/${name}`, import.meta.url)), name)
    assert.ok(parsed.text.trim(), name)
    assert.ok(parsed.blocks.length, name)
  }
  for (const name of ['scanned.pdf', 'encrypted.pdf']) {
    await assert.rejects(parseDocument(await readFile(new URL(`fixtures/${name}`, import.meta.url)), name), error => error instanceof Error && 'code' in error && ['NEEDS_OCR', 'ENCRYPTED_DOCUMENT'].includes(String(error.code)))
  }
})

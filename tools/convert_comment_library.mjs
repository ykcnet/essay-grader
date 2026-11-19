// 將 comment-library-senior.md 轉成 packages/core/src/library/senior.json
// 用法：node tools/convert_comment_library.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const source = join(repoRoot, 'comment-library-senior.md')
const target = join(repoRoot, 'packages', 'core', 'src', 'library', 'senior.json')

const SENTENCE = {
  語句不順: 'awkward',
  贅字冗長: 'redundant',
  用詞不當: 'word_choice',
  口語化: 'colloquial',
  連接與邏輯: 'cohesion',
  文白夾雜: 'mixed_register'
}

const STRUCTURE = {
  離題: 'off_topic',
  缺例證: 'insufficient_evidence',
  段落失衡: 'paragraph_balance',
  轉折不足: 'transition',
  首尾: 'intro_outro',
  段落主題不明: 'unclear_topic'
}

const COMMENT = {
  整體優點: 'strength',
  整體待改進: 'weakness',
  混合型: 'mixed',
  知性題: 'intellectual',
  情意題: 'emotional',
  應用文與實用文體: 'applied'
}

const lines = (await readFile(source, 'utf8')).split(/\r?\n/)
const entries = []

let section = ''
let subsection = ''
let tags = []

for (const line of lines) {
  const sectionMatch = line.match(/^##\s+[一二三四五六七八九十]+、(.+)$/)
  if (sectionMatch) {
    section = sectionMatch[1].trim()
    tags = []
    if (section.includes('通用')) tags.push('通用')
    if (section.includes('高中')) tags.push('高中')
    if (section.includes('高職')) tags.push('高職')
    subsection = ''
    continue
  }

  const subMatch = line.match(/^###\s+[\d.]+\s+(.+)$/)
  if (subMatch) {
    const raw = subMatch[1]
    subsection = raw.split('｜')[0].trim()
    if (raw.includes('高中')) tags = ['高中']
    if (raw.includes('高職')) tags = ['高職']
    if (raw.includes('通用')) tags = ['通用']
    continue
  }

  const row = line.match(/^\|\s*([ESTGC]-\d{2})\s*\|\s*(.+?)\s*\|$/)
  if (!row) continue

  const [, id, text] = row
  const prefix = id[0]
  let category = 'other'
  let subtype = 'general'
  let entryTags = [...tags]

  if (prefix === 'E') {
    category = 'typo'
    subtype = 'general'
  } else if (prefix === 'S') {
    category = 'sentence'
    subtype = SENTENCE[subsection] ?? 'general'
  } else if (prefix === 'T') {
    category = 'structure'
    subtype = STRUCTURE[subsection] ?? 'general'
  } else if (prefix === 'G') {
    category = 'praise'
    subtype = 'general'
  } else if (prefix === 'C') {
    category = 'comment'
    subtype = COMMENT[subsection] ?? 'general'
  }

  if (entryTags.length === 0) entryTags = ['通用']

  entries.push({
    id,
    category,
    subtype,
    text,
    tags: entryTags,
    disabled: false,
    source: 'builtin'
  })
}

const counts = entries.reduce((acc, entry) => {
  acc[entry.category] = (acc[entry.category] ?? 0) + 1
  return acc
}, {})

const library = {
  schema_version: 1,
  library_version: '2026.1',
  locale: 'zh-TW',
  entries
}

await mkdir(dirname(target), { recursive: true })
await writeFile(target, `${JSON.stringify(library, null, 2)}\n`, 'utf8')

console.log(`wrote ${target}`)
console.log(`entries ${entries.length}`, counts)

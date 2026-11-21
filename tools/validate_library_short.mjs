// 短評侷限用語檢查：sentence／structure／praise 不得引用特定詞句、
// 不得寫死段落編號，也不得假設特定事件、人物或物件。
// 例外：sentence 的 word_choice（用詞辨析）可用引號標示具體詞語。
// typo 可保留必要字詞，comment 另由 library:structure 與 library:wording 監督。
// 用法：node tools/validate_library_short.mjs

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

const LIBRARIES = [
  { name: '國中', file: join(repoRoot, 'packages', 'core', 'src', 'library', 'junior.draft.json') },
  { name: '高中職', file: join(repoRoot, 'packages', 'core', 'src', 'library', 'senior.json') }
]

const SHORT_CATEGORIES = new Set(['sentence', 'structure', 'praise'])
const QUOTE_PATTERN = /[「」『』]/
const PARAGRAPH_INDEX_PATTERN = /第[一二三四五六七八九十百]+段/
const FORBIDDEN_TERMS = [
  '考試', '成績', '比賽', '社團', '搬家', '家人', '朋友', '同學', '老師',
  '教室', '書包', '考卷', '時鐘', '腳踏車', '雨景', '晚餐', '月考', '國中', '高中', '大學'
]
const MIN_LENGTH = 10

function normalize(text) {
  return text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '')
}

function lengthOf(text) {
  return [...normalize(text)].length
}

let totalViolations = 0

for (const library of LIBRARIES) {
  const raw = await readFile(library.file, 'utf8').catch(() => null)
  if (raw === null) {
    console.log(`[FAIL] ${library.name} — 找不到 ${library.file}`)
    totalViolations += 1
    continue
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.log(`[FAIL] ${library.name} — JSON 解析失敗：${error instanceof Error ? error.message : String(error)}`)
    totalViolations += 1
    continue
  }

  const entries = (Array.isArray(parsed.entries) ? parsed.entries : []).filter(
    (entry) => SHORT_CATEGORIES.has(entry.category) && typeof entry.text === 'string'
  )
  const violations = []
  let tooShort = 0
  const seen = new Map()

  for (const entry of entries) {
    const text = entry.text
    const reasons = []
    const allowsQuotes = entry.category === 'sentence' && entry.subtype === 'word_choice'

    if (!allowsQuotes && QUOTE_PATTERN.test(text)) reasons.push('含引號')
    if (entry.category === 'structure' && PARAGRAPH_INDEX_PATTERN.test(text)) {
      const hit = text.match(PARAGRAPH_INDEX_PATTERN)[0]
      reasons.push(`寫死段落編號（${hit}）`)
    }
    const forbidden = FORBIDDEN_TERMS.filter((term) => text.includes(term))
    if (forbidden.length > 0) reasons.push(`假設特定事件或人物（${forbidden.join('、')}）`)
    if (/[{}]/.test(text)) reasons.push('含大括號變數')

    const length = lengthOf(text)
    if (length < MIN_LENGTH) {
      tooShort += 1
      reasons.push(`過短（${length} 字）`)
    }

    const key = normalize(text)
    if (seen.has(key)) reasons.push(`與 ${seen.get(key)} 正規化後重複`)
    else seen.set(key, entry.id)

    if (reasons.length > 0) violations.push(`${entry.id}（${reasons.join('；')}）`)
  }

  const counts = entries.reduce((acc, entry) => {
    acc[entry.category] = (acc[entry.category] ?? 0) + 1
    return acc
  }, {})

  if (violations.length === 0) {
    console.log(
      `[PASS] ${library.name} — 短評 ${entries.length} 條（sentence ${counts.sentence ?? 0}、structure ${counts.structure ?? 0}、praise ${counts.praise ?? 0}），未發現侷限用語`
    )
    console.log('  例外：sentence 的 word_choice（用詞辨析）可用引號標示具體詞語；其他短評仍禁用引號。')
    if (tooShort > 0) console.log(`  註：${tooShort} 條短於 ${MIN_LENGTH} 字，已列入違規`)
  } else {
    totalViolations += violations.length
    console.log(`[FAIL] ${library.name} — ${violations.length} 條違規`)
    console.log('  例外：sentence 的 word_choice（用詞辨析）可用引號標示具體詞語；其他短評仍禁用引號。')
    for (const violation of violations) console.log(`  - ${violation}`)
  }
}

console.log(`\nlibrary short ${totalViolations === 0 ? 'PASS' : `FAIL（${totalViolations} 條）`}`)
if (totalViolations > 0) process.exitCode = 1

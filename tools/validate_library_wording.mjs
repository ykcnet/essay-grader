// 評語庫用語檢查：總評、佳句、結構不得以引號引用特定詞句。
// 錯字與語句類仍可使用引號標示具體錯誤。
// 用法：node tools/validate_library_wording.mjs

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const LIBRARIES = [
  { name: '國中', file: join(repoRoot, 'packages', 'core', 'src', 'library', 'junior.draft.json') },
  { name: '高中職', file: join(repoRoot, 'packages', 'core', 'src', 'library', 'senior.json') }
]
const PROSE_CATEGORIES = new Set(['comment', 'praise', 'structure'])
const QUOTE_PATTERN = /[「」『』]/

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

  const entries = Array.isArray(parsed.entries) ? parsed.entries : []
  const violations = entries.filter(
    (entry) => PROSE_CATEGORIES.has(entry.category) && typeof entry.text === 'string' && QUOTE_PATTERN.test(entry.text)
  )

  if (violations.length === 0) {
    console.log(`[PASS] ${library.name} — ${entries.length} 條，總評／佳句／結構均未使用引號`)
  } else {
    totalViolations += violations.length
    console.log(`[FAIL] ${library.name} — ${violations.length} 條違規`)
    for (const entry of violations) {
      console.log(`  - ${entry.id}（${entry.category}）：${entry.text}`)
    }
  }
}

console.log(`\nlibrary wording ${totalViolations === 0 ? 'PASS' : `FAIL（${totalViolations} 條）`}`)
if (totalViolations > 0) process.exitCode = 1

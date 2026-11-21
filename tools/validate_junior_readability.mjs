// 國中版評語可讀性檢查：只檢查 junior.draft.json 的 text。
// 出現抽象術語即失敗；單條過長只警告，不阻擋。
// 用法：node tools/validate_junior_readability.mjs

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const juniorPath = join(repoRoot, 'packages', 'core', 'src', 'library', 'junior.draft.json')

const ABSTRACT_TERMS = [
  '脈絡', '層次', '張力', '意象', '虛實', '遞進', '論證', '文本', '技法', '收束',
  '鋪陳', '統整', '提煉', '轉化', '雋永', '具體而微', '命題', '面向', '結構性',
  '邏輯', '深層', '留白', '審美', '思辨', '辯證', '底蘊', '旨趣', '態勢', '映襯',
  '象徵', '隱喻'
]
const WARN_LENGTH = 90

function normalize(text) {
  return text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '')
}

const raw = await readFile(juniorPath, 'utf8').catch(() => null)
if (raw === null) {
  console.log(`[FAIL] 找不到 ${juniorPath}`)
  process.exitCode = 1
} else {
  let library
  try {
    library = JSON.parse(raw)
  } catch (error) {
    console.log(`[FAIL] JSON 解析失敗：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }

  if (library) {
    const entries = (Array.isArray(library.entries) ? library.entries : []).filter(
      (entry) => typeof entry.text === 'string'
    )

    const violations = []
    const warnings = []
    for (const entry of entries) {
      const hits = ABSTRACT_TERMS.filter((term) => entry.text.includes(term))
      if (hits.length > 0) violations.push({ id: entry.id, terms: hits })
      const length = [...normalize(entry.text)].length
      if (length > WARN_LENGTH) warnings.push({ id: entry.id, length })
    }

    console.log(`檢查 ${entries.length} 條評語文字（僅 junior.draft.json）`)
    if (violations.length === 0) {
      console.log(`[PASS] 未出現抽象術語（清單 ${ABSTRACT_TERMS.length} 個詞）`)
    } else {
      console.log(`[FAIL] ${violations.length} 條出現抽象術語`)
      for (const violation of violations) {
        console.log(`  - ${violation.id}：${violation.terms.join('、')}`)
      }
      process.exitCode = 1
    }

    if (warnings.length === 0) {
      console.log(`[PASS] 單條去標點後均未超過 ${WARN_LENGTH} 字`)
    } else {
      console.log(`[WARN] ${warnings.length} 條超過 ${WARN_LENGTH} 字（只提醒，不阻擋）`)
      for (const warning of warnings) {
        console.log(`  - ${warning.id}：${warning.length} 字`)
      }
    }
  }
}

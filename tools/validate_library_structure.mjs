// 總評結構性檢查：確認兩套評語庫的 comment 條目以文章結構語言書寫。
// 用法：node tools/validate_library_structure.mjs

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

const LIBRARIES = [
  { name: '國中', file: join(repoRoot, 'packages', 'core', 'src', 'library', 'junior.draft.json') },
  { name: '高中職', file: join(repoRoot, 'packages', 'core', 'src', 'library', 'senior.json') }
]

const STRUCTURE_TERMS = [
  '主旨', '段落', '分段', '結構', '順序', '過渡', '轉折', '層次', '例證', '鋪陳', '比例',
  '連貫', '首尾', '主題句', '推論', '安排', '組織', '脈絡', '前後', '呼應', '收束', '切入',
  '節奏', '格式', '資訊', '立場', '理由', '結論', '論點', '場景', '情感線'
]

const QUOTE_PATTERN = /[「」『』]/
const MIN_LENGTH = 30

function normalize(text) {
  return text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '')
}

function lengthOf(text) {
  return [...normalize(text)].length
}

function hasStructureTerm(text) {
  return STRUCTURE_TERMS.filter((term) => text.includes(term))
}

const reports = []
const allCommentTexts = new Map()
let failures = 0

for (const library of LIBRARIES) {
  const raw = await readFile(library.file, 'utf8').catch(() => null)
  if (raw === null) {
    console.log(`[FAIL] ${library.name}：找不到 ${library.file}`)
    failures += 1
    continue
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.log(`[FAIL] ${library.name}：JSON 解析失敗（${error instanceof Error ? error.message : String(error)}）`)
    failures += 1
    continue
  }

  const comments = (Array.isArray(parsed.entries) ? parsed.entries : []).filter(
    (entry) => entry.category === 'comment' && typeof entry.text === 'string'
  )

  const missingTerm = []
  const quoted = []
  const tooShort = []
  const duplicates = []
  const seen = new Map()

  for (const entry of comments) {
    const text = entry.text
    if (hasStructureTerm(text).length === 0) missingTerm.push(entry.id)
    if (QUOTE_PATTERN.test(text)) quoted.push(entry.id)
    if (lengthOf(text) < MIN_LENGTH) tooShort.push(`${entry.id}（${lengthOf(text)} 字）`)

    const key = normalize(text)
    if (seen.has(key)) duplicates.push(`${entry.id}＝${seen.get(key)}`)
    seen.set(key, entry.id)

    if (allCommentTexts.has(key)) duplicates.push(`${entry.id} 與 ${allCommentTexts.get(key)} 正規化後相同`)
    else allCommentTexts.set(key, entry.id)
  }

  const ok = missingTerm.length === 0 && quoted.length === 0 && tooShort.length === 0 && duplicates.length === 0
  if (!ok) failures += 1

  reports.push({ library, comments, missingTerm, quoted, tooShort, duplicates, ok })
}

for (const report of reports) {
  const { library, comments } = report
  const lengths = comments.map((entry) => lengthOf(entry.text))
  console.log(`${library.name}：comment ${comments.length} 條`)
  console.log(`  結構詞覆蓋：${comments.length - report.missingTerm.length}/${comments.length}${report.missingTerm.length ? `，缺結構詞：${report.missingTerm.join('、')}` : ''}`)
  console.log(`  引號檢查：${report.quoted.length === 0 ? 'PASS' : `FAIL（${report.quoted.join('、')}）`}`)
  console.log(`  字數檢查：${report.tooShort.length === 0 ? `PASS（最短 ${Math.min(...lengths)} 字，最長 ${Math.max(...lengths)} 字）` : `FAIL（${report.tooShort.join('、')}）`}`)
  console.log(`  重複檢查：${report.duplicates.length === 0 ? 'PASS' : `FAIL（${report.duplicates.join('、')}）`}`)
  console.log(`  結果：${report.ok ? 'PASS' : 'FAIL'}`)
}

console.log(`\nlibrary structure ${failures === 0 ? 'PASS' : `FAIL（${failures} 套未通過）`}`)
if (failures > 0) process.exitCode = 1

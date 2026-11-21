// 總評五面向用語檢查：依 comment-coverage.json 的 dimensions，
// 確認每條 comment 至少符合一個所屬面向的詞彙，並檢查引號、字數與重複。
// 用法：node tools/validate_library_structure.mjs

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

const LIBRARIES = [
  { name: '國中', side: 'junior', file: join(repoRoot, 'packages', 'core', 'src', 'library', 'junior.draft.json') },
  { name: '高中職', side: 'senior', file: join(repoRoot, 'packages', 'core', 'src', 'library', 'senior.json') }
]
const COVERAGE = join(repoRoot, 'packages', 'core', 'src', 'library', 'comment-coverage.json')

const DIMENSION_TERMS = {
  structure: [
    '主旨', '段落', '分段', '結構', '順序', '過渡', '轉折', '層次', '比例', '連貫',
    '首尾', '主題句', '安排', '組織', '脈絡', '前後', '呼應', '收束', '收尾', '完整', '鋪陳',
    '推進', '布局', '重心', '篇幅', '開頭', '結尾', '首段', '末段', '中段', '段首',
    '先後', '重點', '各段'
  ],
  content: [
    '立意', '取材', '材料', '例證', '例子', '理由', '觀點', '見解', '分析', '反思',
    '論點', '主張', '立場', '推論', '證據', '統整', '切題', '題意', '判斷', '說服',
    '看法', '見解', '內容', '深度', '層次', '反駁', '讓步', '資料', '訊息'
  ],
  language: [
    '用詞', '詞語', '詞彙', '句式', '句型', '句子', '語氣', '修辭', '節奏', '精準',
    '具體', '流暢', '順暢', '冗', '贅', '口語', '標點', '字句', '簡潔', '形容',
    '動詞', '語感', '文句', '斷句', '轉述', '重複', '精簡'
  ],
  emotion: [
    '情感', '情緒', '感受', '共鳴', '真摯', '節制', '內心', '場景', '畫面', '轉折',
    '體悟', '餘味', '抒情', '溫度', '感動', '心情', '脆弱', '和解', '體會'
  ],
  format: [
    '格式', '稱謂', '署名', '對象', '資訊', '順序', '重點', '收束', '書信', '啟事',
    '通知', '留言', '公文', '履歷', '自傳', '簡介', '採訪', '報導', '應用文',
    '收信人', '讀者', '敬語', '職缺', '聯絡方式'
  ]
}

const QUOTE_PATTERN = /[「」『』]/
const MIN_LENGTH = 30

function normalize(text) {
  return text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '')
}

function lengthOf(text) {
  return [...normalize(text)].length
}

function termsIn(text, dimension) {
  return DIMENSION_TERMS[dimension].filter((term) => text.includes(term))
}

const coverage = JSON.parse(await readFile(COVERAGE, 'utf8'))
const dimensions = Array.isArray(coverage.dimensions) ? coverage.dimensions : []
const assignments = { junior: new Map(), senior: new Map() }
for (const dimension of dimensions) {
  for (const side of ['junior', 'senior']) {
    for (const id of dimension[side] ?? []) {
      if (!assignments[side].has(id)) assignments[side].set(id, [])
      assignments[side].get(id).push(dimension.key)
    }
  }
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

  const missingDimension = []
  const mismatchedTerm = []
  const quoted = []
  const tooShort = []
  const duplicates = []
  const seen = new Map()
  const dimensionStats = new Map(dimensions.map((dimension) => [dimension.key, { assigned: 0, covered: 0 }]))

  for (const entry of comments) {
    const text = entry.text
    if (QUOTE_PATTERN.test(text)) quoted.push(entry.id)
    if (lengthOf(text) < MIN_LENGTH) tooShort.push(`${entry.id}（${lengthOf(text)} 字）`)

    const ownDimensions = assignments[library.side].get(entry.id) ?? []
    if (ownDimensions.length === 0) {
      missingDimension.push(entry.id)
    } else {
      const matched = ownDimensions.filter((dimension) => termsIn(text, dimension).length > 0)
      if (matched.length === 0) mismatchedTerm.push(`${entry.id}（${ownDimensions.join('、')}）`)
      for (const dimension of ownDimensions) {
        const stat = dimensionStats.get(dimension)
        stat.assigned += 1
        if (matched.includes(dimension)) stat.covered += 1
      }
    }

    const key = normalize(text)
    if (seen.has(key)) duplicates.push(`${entry.id}＝${seen.get(key)}`)
    seen.set(key, entry.id)

    if (allCommentTexts.has(key)) duplicates.push(`${entry.id} 與 ${allCommentTexts.get(key)} 正規化後相同`)
    else allCommentTexts.set(key, entry.id)
  }

  const ok = missingDimension.length === 0 && mismatchedTerm.length === 0 && quoted.length === 0 && tooShort.length === 0 && duplicates.length === 0
  if (!ok) failures += 1

  reports.push({ library, comments, missingDimension, mismatchedTerm, quoted, tooShort, duplicates, dimensionStats, ok })
}

for (const report of reports) {
  const { library, comments } = report
  const lengths = comments.map((entry) => lengthOf(entry.text))
  console.log(`${library.name}：comment ${comments.length} 條`)
  for (const dimension of dimensions) {
    const stat = report.dimensionStats.get(dimension.key)
    console.log(`  ${dimension.label}詞彙：${stat.covered}/${stat.assigned} 條符合`)
  }
  console.log(`  面向歸屬：${report.missingDimension.length === 0 ? 'PASS' : `FAIL（未歸屬：${report.missingDimension.join('、')}）`}`)
  console.log(`  詞彙對應：${report.mismatchedTerm.length === 0 ? 'PASS' : `FAIL（${report.mismatchedTerm.join('、')}）`}`)
  console.log(`  引號檢查：${report.quoted.length === 0 ? 'PASS' : `FAIL（${report.quoted.join('、')}）`}`)
  console.log(`  字數檢查：${report.tooShort.length === 0 ? `PASS（最短 ${Math.min(...lengths)} 字，最長 ${Math.max(...lengths)} 字）` : `FAIL（${report.tooShort.join('、')}）`}`)
  console.log(`  重複檢查：${report.duplicates.length === 0 ? 'PASS' : `FAIL（${report.duplicates.join('、')}）`}`)
  console.log(`  結果：${report.ok ? 'PASS' : 'FAIL'}`)
}

console.log(`\nlibrary structure ${failures === 0 ? 'PASS' : `FAIL（${failures} 套未通過）`}`)
if (failures > 0) process.exitCode = 1

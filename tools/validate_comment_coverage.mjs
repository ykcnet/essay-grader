// 總評結構覆蓋率檢查：確認 16 類結構錯誤在國中與高中職兩套庫都至少有 2 條 comment，
// 且每個 comment 至少被一個分類涵蓋。
// 用法：node tools/validate_comment_coverage.mjs

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

const COVERAGE = join(repoRoot, 'packages', 'core', 'src', 'library', 'comment-coverage.json')
const LIBRARIES = {
  junior: join(repoRoot, 'packages', 'core', 'src', 'library', 'junior.draft.json'),
  senior: join(repoRoot, 'packages', 'core', 'src', 'library', 'senior.json')
}
const MARKDOWN = {
  junior: join(repoRoot, 'comment-library-junior.md'),
  senior: join(repoRoot, 'comment-library-senior.md')
}
const MIN_PER_CATEGORY = 2
const EXPECTED_COMMENTS = 60

export function buildCoverageTable(categories) {
  const lines = []
  lines.push('| 結構分類 | junior 條數 | senior 條數 |')
  lines.push('|---|---:|---:|')
  for (const category of categories) {
    lines.push(`| ${category.label} | ${category.junior.length} | ${category.senior.length} |`)
  }
  const juniorTotal = categories.reduce((sum, category) => sum + category.junior.length, 0)
  const seniorTotal = categories.reduce((sum, category) => sum + category.senior.length, 0)
  lines.push(`| **分類對應次數（同一條可支援多類）** | **${juniorTotal}** | **${seniorTotal}** |`)
  return lines.join('\n')
}

function normalize(text) {
  return text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '')
}

function loadCommentMap(library, name, failures) {
  const entries = Array.isArray(library.entries) ? library.entries : []
  const comments = entries.filter((entry) => entry.category === 'comment')
  if (comments.length !== EXPECTED_COMMENTS) {
    failures.push(`${name} comment 應為 ${EXPECTED_COMMENTS} 條，目前 ${comments.length} 條`)
  }
  const map = new Map()
  for (const entry of comments) {
    if (map.has(entry.id)) failures.push(`${name} 有重複 id：${entry.id}`)
    map.set(entry.id, entry)
  }
  return map
}

function checkCategorySide(category, side, commentMap, name, failures, covered) {
  const ids = category[side]
  if (!Array.isArray(ids)) {
    failures.push(`${category.key}／${side} 必須是陣列`)
    return
  }
  if (ids.length < MIN_PER_CATEGORY) {
    failures.push(`${category.key}／${side} 只有 ${ids.length} 條，至少需要 ${MIN_PER_CATEGORY} 條`)
  }
  if (ids.length < 3 || ids.length > 5) {
    console.log(`[WARN] ${category.key}／${side} 有 ${ids.length} 條；建議 3–5 條`)
  }
  const seen = new Set()
  for (const id of ids) {
    if (seen.has(id)) {
      failures.push(`${category.key}／${side} 重複列出 ${id}`)
      continue
    }
    seen.add(id)
    const entry = commentMap.get(id)
    if (!entry) {
      failures.push(`${category.key}／${side} 找不到 category=comment 的 ${id}`)
      continue
    }
    if (typeof entry.text !== 'string' || normalize(entry.text).length === 0) {
      failures.push(`${category.key}／${side} 的 ${id} 沒有有效文字`)
    }
    covered.add(id)
  }
}

async function main() {
  const failures = []

  const coverageRaw = await readFile(COVERAGE, 'utf8').catch(() => null)
  if (coverageRaw === null) {
    console.log(`[FAIL] 找不到 ${COVERAGE}`)
    process.exitCode = 1
    return
  }
  const coverage = JSON.parse(coverageRaw)
  const categories = Array.isArray(coverage.categories) ? coverage.categories : []
  if (categories.length === 0) failures.push('coverage.categories 不可為空')

  const keys = new Set()
  const labels = new Set()
  for (const category of categories) {
    for (const field of ['key', 'label', 'basis']) {
      if (typeof category[field] !== 'string' || category[field].trim() === '') {
        failures.push(`分類缺少 ${field}：${category.key ?? '(未命名)'}`)
      }
    }
    if (keys.has(category.key)) failures.push(`分類 key 重複：${category.key}`)
    keys.add(category.key)
    if (labels.has(category.label)) failures.push(`分類 label 重複：${category.label}`)
    labels.add(category.label)
  }

  const juniorLibrary = JSON.parse(await readFile(LIBRARIES.junior, 'utf8'))
  const seniorLibrary = JSON.parse(await readFile(LIBRARIES.senior, 'utf8'))
  const juniorMap = loadCommentMap(juniorLibrary, 'junior', failures)
  const seniorMap = loadCommentMap(seniorLibrary, 'senior', failures)

  const covered = { junior: new Set(), senior: new Set() }
  for (const category of categories) {
    checkCategorySide(category, 'junior', juniorMap, 'junior', failures, covered.junior)
    checkCategorySide(category, 'senior', seniorMap, 'senior', failures, covered.senior)
  }

  for (const [side, map] of [
    ['junior', juniorMap],
    ['senior', seniorMap]
  ]) {
    const orphans = [...map.keys()].filter((id) => !covered[side].has(id))
    if (orphans.length > 0) {
      failures.push(`${side} 有 ${orphans.length} 條未被任何分類覆蓋：${orphans.join('、')}`)
    }
  }

  const table = buildCoverageTable(categories)
  for (const side of ['junior', 'senior']) {
    const markdown = await readFile(MARKDOWN[side], 'utf8').catch(() => null)
    if (markdown === null) {
      failures.push(`找不到 ${MARKDOWN[side]}`)
    } else if (!markdown.includes(table)) {
      failures.push(`${side} Markdown 的結構覆蓋摘要與 coverage JSON 不一致`)
    }
  }

  console.log('結構分類覆蓋：')
  for (const category of categories) {
    console.log(`  ${category.key.padEnd(22)} ${category.label.padEnd(14, '　')} junior ${category.junior.length}、senior ${category.senior.length}`)
  }
  console.log('')
  console.log(table)
  console.log('')
  console.log(`junior comment 覆蓋：${covered.junior.size}/${juniorMap.size}`)
  console.log(`senior comment 覆蓋：${covered.senior.size}/${seniorMap.size}`)

  if (failures.length > 0) {
    console.log('')
    for (const failure of failures) console.log(`[FAIL] ${failure}`)
    console.log(`\nlibrary coverage FAIL（${failures.length} 項）`)
    process.exitCode = 1
    return
  }

  console.log('\nlibrary coverage PASS')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}

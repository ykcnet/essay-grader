// 評語覆蓋率檢查：五面向最低條數、ID 對應、每條 comment 至少屬於一個面向，
// 以及 19 類結構分類的 ID 對應。Markdown 需同時包含面向分布與結構覆蓋摘要。
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
const EXPECTED_COMMENTS = 72

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

export function buildDimensionTable(dimensions) {
  const lines = []
  lines.push('| 面向 | 最低條數 | junior 條數 | senior 條數 |')
  lines.push('|---|---:|---:|---:|')
  for (const dimension of dimensions) {
    lines.push(`| ${dimension.label} | ${dimension.minimum} | ${dimension.junior.length} | ${dimension.senior.length} |`)
  }
  const juniorTotal = dimensions.reduce((sum, dimension) => sum + dimension.junior.length, 0)
  const seniorTotal = dimensions.reduce((sum, dimension) => sum + dimension.senior.length, 0)
  lines.push(`| **面向歸屬次數（同一條可跨面向）** | | **${juniorTotal}** | **${seniorTotal}** |`)
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

function checkIds(ids, side, key, commentMap, failures, covered) {
  if (!Array.isArray(ids)) {
    failures.push(`${key}／${side} 必須是陣列`)
    return
  }
  const seen = new Set()
  for (const id of ids) {
    if (seen.has(id)) {
      failures.push(`${key}／${side} 重複列出 ${id}`)
      continue
    }
    seen.add(id)
    const entry = commentMap.get(id)
    if (!entry) {
      failures.push(`${key}／${side} 找不到 category=comment 的 ${id}`)
      continue
    }
    if (typeof entry.text !== 'string' || normalize(entry.text).length === 0) {
      failures.push(`${key}／${side} 的 ${id} 沒有有效文字`)
    }
    covered.add(id)
  }
}

function checkCategory(category, side, commentMap, failures) {
  const ids = category[side]
  checkIds(ids, side, category.key, commentMap, failures, new Set())
  if (Array.isArray(ids)) {
    if (ids.length < MIN_PER_CATEGORY) {
      failures.push(`${category.key}／${side} 只有 ${ids.length} 條，至少需要 ${MIN_PER_CATEGORY} 條`)
    }
    if (ids.length < 3 || ids.length > 5) {
      console.log(`[WARN] ${category.key}／${side} 有 ${ids.length} 條；建議 3–5 條`)
    }
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
  const dimensions = Array.isArray(coverage.dimensions) ? coverage.dimensions : []
  if (categories.length === 0) failures.push('coverage.categories 不可為空')
  if (dimensions.length !== 5) failures.push(`coverage.dimensions 應為 5 項，目前 ${dimensions.length} 項`)

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

  const dimensionKeys = new Set()
  const dimensionLabels = new Set()
  for (const dimension of dimensions) {
    for (const field of ['key', 'label']) {
      if (typeof dimension[field] !== 'string' || dimension[field].trim() === '') {
        failures.push(`面向缺少 ${field}：${dimension.key ?? '(未命名)'}`)
      }
    }
    if (typeof dimension.minimum !== 'number' || dimension.minimum < 1) {
      failures.push(`面向 ${dimension.key ?? '(未命名)'} 的 minimum 必須是正整數`)
    }
    if (dimensionKeys.has(dimension.key)) failures.push(`面向 key 重複：${dimension.key}`)
    dimensionKeys.add(dimension.key)
    if (dimensionLabels.has(dimension.label)) failures.push(`面向 label 重複：${dimension.label}`)
    dimensionLabels.add(dimension.label)
  }
  if (!dimensionKeys.has('structure') || !dimensionKeys.has('content') || !dimensionKeys.has('language') || !dimensionKeys.has('emotion') || !dimensionKeys.has('format')) {
    failures.push('面向必須包含 structure、content、language、emotion、format')
  }

  const juniorLibrary = JSON.parse(await readFile(LIBRARIES.junior, 'utf8'))
  const seniorLibrary = JSON.parse(await readFile(LIBRARIES.senior, 'utf8'))
  const juniorMap = loadCommentMap(juniorLibrary, 'junior', failures)
  const seniorMap = loadCommentMap(seniorLibrary, 'senior', failures)

  const covered = { junior: new Set(), senior: new Set() }
  for (const category of categories) {
    checkCategory(category, 'junior', juniorMap, failures)
    checkCategory(category, 'senior', seniorMap, failures)
  }

  for (const dimension of dimensions) {
    for (const side of ['junior', 'senior']) {
      const ids = dimension[side]
      if (!Array.isArray(ids)) {
        failures.push(`${dimension.key}／${side} 必須是陣列`)
        continue
      }
      if (ids.length < dimension.minimum) {
        failures.push(`${dimension.key}／${side} 只有 ${ids.length} 條，低於最低 ${dimension.minimum} 條`)
      }
      checkIds(ids, side, dimension.key, side === 'junior' ? juniorMap : seniorMap, failures, covered[side])
    }
  }

  for (const [side, map] of [
    ['junior', juniorMap],
    ['senior', seniorMap]
  ]) {
    const orphans = [...map.keys()].filter((id) => !covered[side].has(id))
    if (orphans.length > 0) {
      failures.push(`${side} 有 ${orphans.length} 條未屬於任何面向：${orphans.join('、')}`)
    }
  }

  const dimensionTable = buildDimensionTable(dimensions)
  const categoryTable = buildCoverageTable(categories)
  for (const side of ['junior', 'senior']) {
    const markdown = await readFile(MARKDOWN[side], 'utf8').catch(() => null)
    if (markdown === null) {
      failures.push(`找不到 ${MARKDOWN[side]}`)
      continue
    }
    if (!markdown.includes('面向分布')) failures.push(`${side} Markdown 缺少面向分布段落`)
    if (!markdown.includes(dimensionTable)) failures.push(`${side} Markdown 的面向分布表與 coverage JSON 不一致`)
    if (!markdown.includes('結構覆蓋摘要')) failures.push(`${side} Markdown 缺少結構覆蓋摘要段落`)
    if (!markdown.includes(categoryTable)) failures.push(`${side} Markdown 的結構覆蓋摘要與 coverage JSON 不一致`)
  }

  console.log('五面向分布：')
  for (const dimension of dimensions) {
    console.log(`  ${dimension.key.padEnd(10)} ${dimension.label.padEnd(6, '　')} 最低 ${String(dimension.minimum).padStart(2)}｜junior ${dimension.junior.length}、senior ${dimension.senior.length}`)
  }
  console.log('')
  console.log(dimensionTable)
  console.log('')
  console.log('結構分類覆蓋：')
  for (const category of categories) {
    console.log(`  ${category.key.padEnd(22)} ${category.label.padEnd(14, '　')} junior ${category.junior.length}、senior ${category.senior.length}`)
  }
  console.log('')
  console.log(categoryTable)
  console.log('')
  console.log(`junior comment 面向覆蓋：${covered.junior.size}/${juniorMap.size}`)
  console.log(`senior comment 面向覆蓋：${covered.senior.size}/${seniorMap.size}`)

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

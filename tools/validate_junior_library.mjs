// 國中版評語庫草稿自動檢查
// 用法：node tools/validate_junior_library.mjs

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMarkdown } from './render_junior_library.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const juniorPath = join(repoRoot, 'packages', 'core', 'src', 'library', 'junior.draft.json')
const seniorPath = join(repoRoot, 'packages', 'core', 'src', 'library', 'senior.json')
const markdownPath = join(repoRoot, 'comment-library-junior.md')

const ALLOWED = {
  typo: ['general'],
  sentence: ['awkward', 'word_order', 'word_choice', 'redundant', 'ambiguous', 'cohesion', 'colloquial', 'mixed_register'],
  structure: ['off_topic', 'insufficient_evidence', 'paragraph_balance', 'transition', 'intro_outro', 'unclear_topic'],
  praise: ['general'],
  comment: ['strength', 'weakness', 'mixed', 'intellectual', 'emotional', 'applied']
}

const EXPECTED_CATEGORY = { typo: 10, sentence: 23, structure: 23, praise: 10, comment: 72 }
const EXPECTED_SUBTYPE = {
  typo: { general: 10 },
  sentence: { awkward: 4, word_order: 3, word_choice: 4, redundant: 3, ambiguous: 3, cohesion: 3, colloquial: 2, mixed_register: 1 },
  structure: { off_topic: 4, insufficient_evidence: 4, paragraph_balance: 4, transition: 4, intro_outro: 4, unclear_topic: 3 },
  praise: { general: 10 },
  comment: { strength: 10, weakness: 10, mixed: 10, intellectual: 14, emotional: 18, applied: 10 }
}

const PREFIX = { typo: 'JE', sentence: 'JS', structure: 'JT', praise: 'JG', comment: 'JC' }

function normalize(text) {
  return text.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '')
}

function count(entries, key, value) {
  return entries.filter((entry) => entry[key] === value).length
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const checks = []
async function check(name, fn) {
  try {
    const detail = await fn()
    checks.push({ ok: true, name, detail })
  } catch (error) {
    checks.push({ ok: false, name, detail: error instanceof Error ? error.message : String(error) })
  }
}

const juniorRaw = await readFile(juniorPath, 'utf8').catch(() => null)
const seniorRaw = await readFile(seniorPath, 'utf8').catch(() => null)
let library = null
let senior = null

await check('JSON 可解析', () => {
  assert(juniorRaw !== null, '找不到 junior.draft.json')
  library = JSON.parse(juniorRaw)
  assert(library && typeof library === 'object', 'root 必須是物件')
  assert(seniorRaw !== null, '找不到 senior.json')
  senior = JSON.parse(seniorRaw)
  return 'junior.draft.json 與 senior.json 解析成功'
})

if (library) {
  const entries = Array.isArray(library.entries) ? library.entries : []

  await check('必要欄位與版本', () => {
    assert(library.schema_version === 1, 'schema_version 必須是 1')
    assert(typeof library.library_version === 'string' && library.library_version.length > 0, 'library_version 不可空白')
    assert(library.library_version === '2026.2-draft', 'library_version 必須是 2026.2-draft')
    assert(library.locale === 'zh-TW', 'locale 必須是 zh-TW')
    assert(Array.isArray(library.entries), 'entries 必須是陣列')
    return `schema_version 1／${library.library_version}／${library.locale}`
  })

  await check('每條必要欄位齊全', () => {
    const required = ['id', 'category', 'subtype', 'text', 'tags', 'disabled', 'source']
    entries.forEach((entry, index) => {
      for (const key of required) {
        assert(Object.prototype.hasOwnProperty.call(entry, key), `第 ${index + 1} 條缺少 ${key}`)
      }
      assert(typeof entry.id === 'string' && entry.id.length > 0, `第 ${index + 1} 條 id 不可空白`)
      assert(typeof entry.text === 'string' && entry.text.trim().length > 0, `第 ${index + 1} 條 text 不可空白`)
      assert(Array.isArray(entry.tags) && entry.tags.length > 0, `第 ${index + 1} 條 tags 不可空白`)
      assert(typeof entry.disabled === 'boolean', `第 ${index + 1} 條 disabled 必須是布林值`)
    })
    return `${entries.length} 條欄位齊全`
  })

  await check('總數 138', () => {
    assert(entries.length === 138, `目前 ${entries.length} 條`)
    return '138 條'
  })

  await check('分類數量', () => {
    const actual = Object.fromEntries(Object.keys(EXPECTED_CATEGORY).map((category) => [category, count(entries, 'category', category)]))
    for (const [category, expected] of Object.entries(EXPECTED_CATEGORY)) {
      assert(actual[category] === expected, `${category} 應為 ${expected}，目前 ${actual[category]}`)
    }
    return Object.entries(actual).map(([key, value]) => `${key} ${value}`).join('、')
  })

  await check('子類數量', () => {
    for (const [category, expectedMap] of Object.entries(EXPECTED_SUBTYPE)) {
      const rows = entries.filter((entry) => entry.category === category)
      for (const [subtype, expected] of Object.entries(expectedMap)) {
        const actual = count(rows, 'subtype', subtype)
        assert(actual === expected, `${category}/${subtype} 應為 ${expected}，目前 ${actual}`)
      }
    }
    return '五類子類數量全部正確'
  })

  await check('subtype 為該類別允許值', () => {
    entries.forEach((entry) => {
      const allowed = ALLOWED[entry.category]
      assert(allowed, `${entry.id} 類別 ${entry.category} 不合法`)
      assert(allowed.includes(entry.subtype), `${entry.id} 子類 ${entry.subtype} 不屬於 ${entry.category}`)
    })
    return '全部符合'
  })

  await check('id 格式與類別前綴', () => {
    entries.forEach((entry) => {
      const pattern = new RegExp(`^${PREFIX[entry.category]}-\\d{2}$`)
      assert(pattern.test(entry.id), `${entry.id} 格式或前綴不符 ${entry.category}`)
    })
    return 'JE／JS／JT／JG／JC 前綴正確'
  })

  await check('id 唯一且不與高中職版重複', () => {
    const ids = entries.map((entry) => entry.id)
    assert(new Set(ids).size === ids.length, '有重複的 id')
    const seniorIds = new Set(senior.entries.map((entry) => entry.id))
    const overlap = ids.filter((id) => seniorIds.has(id))
    assert(overlap.length === 0, `與高中職版重複：${overlap.join('、')}`)
    return '138 個 id 全部唯一'
  })

  await check('text 正規化後唯一', () => {
    const seen = new Map()
    entries.forEach((entry) => {
      const key = normalize(entry.text)
      assert(!seen.has(key), `${entry.id} 與 ${seen.get(key)} 正規化後相同`)
      seen.set(key, entry.id)
    })
    return '138 條文字皆不同'
  })

  await check('總評每條至少 30 字', () => {
    const comments = entries.filter((entry) => entry.category === 'comment')
    comments.forEach((entry) => {
      const length = [...normalize(entry.text)].length
      assert(length >= 30, `${entry.id} 只有 ${length} 字`)
    })
    const lengths = comments.map((entry) => [...normalize(entry.text)].length)
    return `${comments.length} 條，${Math.min(...lengths)}–${Math.max(...lengths)} 字`
  })

  await check('tags 至少含「國中」', () => {
    entries.forEach((entry) => {
      assert(entry.tags.includes('國中'), `${entry.id} 缺少「國中」標籤`)
    })
    return '全部具備'
  })

  await check('source 一律 builtin', () => {
    entries.forEach((entry) => {
      assert(entry.source === 'builtin', `${entry.id} source 為 ${entry.source}`)
    })
    return '138 條皆為 builtin'
  })

  await check('disabled 一律 false', () => {
    entries.forEach((entry) => {
      assert(entry.disabled === false, `${entry.id} disabled 不為 false`)
    })
    return '138 條皆啟用'
  })

  await check('不可含大括號變數', () => {
    entries.forEach((entry) => {
      assert(!/[{}]/.test(entry.text), `${entry.id} 含大括號`)
      entry.tags.forEach((tag) => assert(!/[{}]/.test(tag), `${entry.id} 標籤含大括號`))
    })
    return '未發現 { 或 }'
  })

  await check('與高中職版無完全相同的正規化文字', () => {
    const seniorTexts = new Map(senior.entries.map((entry) => [normalize(entry.text), entry.id]))
    const duplicates = []
    entries.forEach((entry) => {
      const match = seniorTexts.get(normalize(entry.text))
      if (match) duplicates.push(`${entry.id}＝${match}`)
    })
    assert(duplicates.length === 0, `重複：${duplicates.join('、')}`)
    return '與 senior.json 138 條全部不同'
  })

  await check('Markdown 與 JSON 一致', async () => {
    const markdown = await readFile(markdownPath, 'utf8').catch(() => null)
    assert(markdown !== null, '找不到 comment-library-junior.md')
    assert(markdown === buildMarkdown(library), 'Markdown 與 JSON 不一致，請執行 npm run junior:render')
    return '表格與條數同步'
  })
}

for (const [index, item] of checks.entries()) {
  const mark = item.ok ? 'PASS' : 'FAIL'
  console.log(`[${String(index + 1).padStart(2, '0')}] ${mark} ${item.name}${item.detail ? ` — ${item.detail}` : ''}`)
}

const passed = checks.filter((item) => item.ok).length
console.log(`\njunior library ${passed}/${checks.length}`)

if (passed !== checks.length) {
  process.exitCode = 1
}

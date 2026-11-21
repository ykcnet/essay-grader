// 由 packages/core/src/library/junior.draft.json 產生 comment-library-junior.md
// 用法：node tools/render_junior_library.mjs

import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildCoverageTable, buildDimensionTable } from './validate_comment_coverage.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const source = join(repoRoot, 'packages', 'core', 'src', 'library', 'junior.draft.json')
const coverageSource = join(repoRoot, 'packages', 'core', 'src', 'library', 'comment-coverage.json')
const target = join(repoRoot, 'comment-library-junior.md')
const coverage = JSON.parse(readFileSync(coverageSource, 'utf8'))
const coverageTable = buildCoverageTable(coverage.categories)
const dimensionTable = buildDimensionTable(coverage.dimensions)

const SUBTYPE_LABELS = {
  general: '一般',
  awkward: '語句不順',
  word_order: '語序',
  word_choice: '用詞不當',
  redundant: '贅字冗長',
  ambiguous: '語意不清',
  cohesion: '連接與邏輯',
  colloquial: '口語化',
  mixed_register: '文白夾雜',
  off_topic: '離題',
  insufficient_evidence: '缺例證',
  paragraph_balance: '段落失衡',
  transition: '轉折不足',
  intro_outro: '首尾',
  unclear_topic: '段落主題不明',
  strength: '整體優點',
  weakness: '整體待改進',
  mixed: '混合型（優缺並陳）',
  intellectual: '知性題',
  emotional: '情意題',
  applied: '應用文'
}

const SECTIONS = [
  {
    title: '一、錯別字與標點（短評）',
    category: 'typo',
    prefix: 'JE',
    intro: '針對錯字、標點與基本格式，直接指出規則；不在此寫長篇作文評語。',
    subtypes: ['general']
  },
  {
    title: '二、語句（不設字數下限）',
    category: 'sentence',
    prefix: 'JS',
    intro: '每條都指出句子卡住的原因，並給出具體的修改方向。',
    subtypes: ['awkward', 'word_order', 'word_choice', 'redundant', 'ambiguous', 'cohesion', 'colloquial', 'mixed_register']
  },
  {
    title: '三、結構（不設字數下限）',
    category: 'structure',
    prefix: 'JT',
    intro: '盡量指明段落位置或調整策略，讓學生知道從哪裡改、怎麼改。',
    subtypes: ['off_topic', 'insufficient_evidence', 'paragraph_balance', 'transition', 'intro_outro', 'unclear_topic']
  },
  {
    title: '四、佳句（短評）',
    category: 'praise',
    prefix: 'JG',
    intro: '針對文本技巧的具體讚美，避免只寫「寫得很好」。',
    subtypes: ['general']
  },
  {
    title: '五、總評（每條至少 30 字）',
    category: 'comment',
    prefix: 'JC',
    intro: '每條去除標點與空白後至少 30 字，可獨立使用，不必看原圖也能理解。',
    subtypes: ['strength', 'weakness', 'mixed', 'intellectual', 'emotional', 'applied']
  }
]

const CATEGORY_LABELS = {
  typo: '錯別字與標點',
  sentence: '語句',
  structure: '結構',
  praise: '佳句',
  comment: '總評'
}

function countBy(entries, key, value) {
  return entries.filter((entry) => entry[key] === value).length
}

function escapeCell(text) {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export function buildMarkdown(library) {
  const entries = library.entries
  const lines = []

  lines.push('# Essay Grader — 國中版評語庫（草稿）')
  lines.push('')
  lines.push(`> 版本 ${library.library_version} ｜ 2026-11-20`)
  lines.push('>')
  lines.push('> **狀態：草稿，尚未接入程式；待國中國文老師校閱後再啟用。**')
  lines.push('>')
  lines.push('> 適用：國中七～九年級、國中教育會考寫作測驗')
  lines.push('>')
  lines.push('> 總評以五個面向編寫：結構、立意取材、語言表達、情感體驗、格式應用；結構只是其中之一。')
  lines.push('>')
  lines.push('> 依據：[docs/評語庫結構依據.md](docs/評語庫結構依據.md)。總評依國中教育會考寫作測驗評分規準、學測國寫評分原則與教學常見症狀編寫；來源與檢索日期見該檔。')
  lines.push('>')
  lines.push('> 程式目前仍只載入高中職版 `senior.json`；本檔與 `junior.draft.json` 不會進入 runtime。')
  lines.push('')
  lines.push('**使用規則**')
  lines.push('')
  lines.push('- 總評（JC）每條去除標點與空白後至少 30 字，建議 45–90 字；接入後沿用「同批最多 2 次」的既有規則。')
  lines.push('- 總評以五個面向編寫：結構、立意取材、語言表達、情感體驗、格式應用；結構只是其中之一，讓老師依文章問題選擇合適的評語。')
  lines.push('- 每條總評至少屬於一個面向，可跨兩個面向；`面向-結構`、`面向-立意`、`面向-語言`、`面向-情感`、`面向-格式` 標籤供搜尋使用。')
  lines.push('- 其餘類別（錯字、語句、結構、佳句）不設字數下限，重複僅提示、不阻擋。')
  lines.push('- 每條 `tags` 至少含「國中」，可再依題材細分為會考、記敘、抒情、議論、說明、應用等。')
  lines.push('- 本庫不使用 `{姓名}`、`{分數}` 等變數，避免 UI 直接顯示大括號。')
  lines.push('- 總評與佳句以通用說法為主，不假設作品一定出現某個物件、人物關係或事件；需要舉例時，使用文中人物、這個動作、當時的場景、關鍵物件等通用指稱。')
  lines.push('- 錯字可用引號標示必要字詞；語句、結構、佳句與總評避免引號與特定題材假設，改用通用描述。')
  lines.push('- 短評（錯字、語句、結構、佳句）避免假設學生一定寫了某個詞、某個段落編號、某個事件或人物；錯字規則可保留必要字詞，語句與結構改用通用描述。')
  lines.push('- JSON 是唯一來源；修改後請依序執行 `npm run junior:render`、`npm run junior:check`（含用語引號檢查）重新產生並驗證本檔。')
  lines.push('- 短評改寫後請執行 `npm run library:short`，檢查引號、段落編號、特定事件與人物假設。')
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('## 條數統計')
  lines.push('')
  lines.push('| 類別 | 條數 | 子類 |')
  lines.push('|---|---:|---|')
  for (const section of SECTIONS) {
    const sectionEntries = entries.filter((entry) => entry.category === section.category)
    const detail = section.subtypes
      .map((subtype) => `${SUBTYPE_LABELS[subtype]} ${countBy(sectionEntries, 'subtype', subtype)}`)
      .join('、')
    lines.push(`| ${CATEGORY_LABELS[section.category]}（${section.prefix}） | ${sectionEntries.length} | ${detail} |`)
  }
  lines.push(`| **合計** | **${entries.length}** | |`)
  lines.push('')
  lines.push('## 五面向分布')
  lines.push('')
  lines.push('> 總評分為結構、立意取材、語言表達、情感體驗、格式應用五個面向；同一條可支援多個面向，結構不是唯一主軸。完整 ID 清單見 `packages/core/src/library/comment-coverage.json`。')
  lines.push('')
  lines.push(dimensionTable)
  lines.push('')
  lines.push('## 結構覆蓋摘要')
  lines.push('')
  lines.push(`> 另依 \`docs/評語庫結構依據.md\` 的 ${coverage.categories.length} 類結構症狀對應實際總評；同一條可支援多個分類。完整 ID 清單見 \`packages/core/src/library/comment-coverage.json\`。`)
  lines.push('')
  lines.push(coverageTable)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const section of SECTIONS) {
    const sectionEntries = entries.filter((entry) => entry.category === section.category)
    lines.push(`## ${section.title}`)
    lines.push('')
    lines.push(section.intro)
    lines.push('')
    for (const subtype of section.subtypes) {
      const group = sectionEntries.filter((entry) => entry.subtype === subtype)
      if (section.subtypes.length > 1) {
        lines.push(`### ${SUBTYPE_LABELS[subtype]}（${group.length} 條）`)
        lines.push('')
      }
      lines.push('| 編號 | 評語 |')
      lines.push('|---|---|')
      for (const entry of group) {
        lines.push(`| ${entry.id} | ${escapeCell(entry.text)} |`)
      }
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  }

  lines.push('## 校閱重點')
  lines.push('')
  lines.push('1. **語氣**：是否適合國中七～九年級？用語夠不夠淺白、句子會不會太長？')
  lines.push('2. **會考對應**：知性題與情意題的評語，是否對得上國中教育會考寫作測驗的常見題型與評分規準？')
  lines.push('3. **文言與應用文**：是否保留文言相關條目（JS 文白夾雜 1 條）？應用文目前涵蓋書信、留言、啟事、通知、簡介、採訪，是否足夠？')
  lines.push('4. **七年級適用**：是否有對七年級偏難的詞彙或概念？需要分年級標籤嗎？')
  lines.push('5. **獨立性**：每條總評能否不看原圖就理解？是否會假設學生性別、家庭結構或成績高低？')
  lines.push('6. **重複感**：抽樣閱讀時，句型是否過於相似？是否需要再增加變化？')
  lines.push('')
  lines.push('## 接入方式（校閱後）')
  lines.push('')
  lines.push('- 依班級學制選擇評語庫：`junior` 載入 `junior.draft.json`（校閱後可改名為 `junior.json`），`senior`／`vocational` 載入 `senior.json`。')
  lines.push('- 或在設定新增開關，讓老師手動指定使用版本。')
  lines.push('- 接入時才調整 `packages/core/src/library.ts` 與 `BUILTIN_LIBRARY`；草稿階段刻意不動 runtime。')
  lines.push('- 校閱後的修改請先改 JSON，再執行 `npm run junior:render`，最後跑 `npm run junior:check`。')
  lines.push('')

  return `${lines.join('\n')}\n`
}

async function main() {
  const library = JSON.parse(await readFile(source, 'utf8'))
  await writeFile(target, buildMarkdown(library), 'utf8')
  console.log(`wrote ${target}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}

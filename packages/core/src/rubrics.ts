import type { Rubric } from './schema'

/**
 * 量規預設值（暫定，待老師確認）。
 * 三組只調整分項配分，扣分與等第門檻相同：
 * 分項加總 100；錯字／標點另外扣，上限 10 分，避免重複計算。
 */
const DEFAULT_DEDUCTION = { typo_per: 0.5, punct_per: 0.5, cap: 10 } as const

const DEFAULT_GRADES = [
  { label: 'A++', min: 90 },
  { label: 'A+', min: 85 },
  { label: 'A', min: 80 },
  { label: 'B++', min: 75 },
  { label: 'B+', min: 70 },
  { label: 'B', min: 65 },
  { label: 'C', min: 60 }
] as const

const BALANCED: Rubric = {
  id: 'balanced-default',
  items: [
    { id: 'content', name: '內容與思想', max: 40 },
    { id: 'structure', name: '結構與組織', max: 30 },
    { id: 'language', name: '語言與表達', max: 30 }
  ],
  deduction: { ...DEFAULT_DEDUCTION },
  grades: [...DEFAULT_GRADES]
}

const CONTENT: Rubric = {
  id: 'content-default',
  items: [
    { id: 'content', name: '內容與思想', max: 45 },
    { id: 'structure', name: '結構與組織', max: 25 },
    { id: 'language', name: '語言與表達', max: 30 }
  ],
  deduction: { ...DEFAULT_DEDUCTION },
  grades: [...DEFAULT_GRADES]
}

const LANGUAGE: Rubric = {
  id: 'language-default',
  items: [
    { id: 'content', name: '內容與思想', max: 35 },
    { id: 'structure', name: '結構與組織', max: 30 },
    { id: 'language', name: '語言與表達', max: 35 }
  ],
  deduction: { ...DEFAULT_DEDUCTION },
  grades: [...DEFAULT_GRADES]
}

export const RUBRIC_PRESETS = {
  balanced: BALANCED,
  content: CONTENT,
  language: LANGUAGE,
  // 舊 id 保留為 balanced 的別名，避免既有 assignment.json 失效。
  junior: BALANCED,
  senior: BALANCED,
  vocational: BALANCED
} as const satisfies Record<string, Rubric>

export type RubricPresetId = keyof typeof RUBRIC_PRESETS

/** UI 下拉只顯示這三組；舊 id 僅為相容而保留。 */
export const RUBRIC_PRESET_ORDER = ['balanced', 'content', 'language'] as const
export type RubricPresetBaseId = (typeof RUBRIC_PRESET_ORDER)[number]

export const RUBRIC_PRESET_LABELS: Record<RubricPresetBaseId, string> = {
  balanced: '均衡版',
  content: '內容導向',
  language: '語言導向'
}

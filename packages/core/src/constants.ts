/**
 * 不依賴 zod 的常數，供 renderer 使用，避免把整個 schema 打包進前端。
 */

export const SCHEMA_VERSION = 1
export const LIBRARY_VERSION = '2026.1'

export const ANNOTATION_CATEGORIES = [
  'typo',
  'sentence',
  'structure',
  'praise',
  'comment',
  'other'
] as const

export type AnnotationCategory = (typeof ANNOTATION_CATEGORIES)[number]

export const ANNOTATION_CATEGORY_LABELS: Record<AnnotationCategory, string> = {
  typo: '錯字',
  sentence: '語句',
  structure: '結構',
  praise: '佳句',
  comment: '評語',
  other: '其他'
}

/** 語句子類：D25 詞句不通順就是 `awkward`。 */
export const SENTENCE_SUBTYPES = [
  { id: 'awkward', label: '不通順' },
  { id: 'word_order', label: '語序' },
  { id: 'word_choice', label: '用詞' },
  { id: 'redundant', label: '冗贅' },
  { id: 'ambiguous', label: '語意不清' },
  { id: 'cohesion', label: '銜接' },
  { id: 'colloquial', label: '口語化' },
  { id: 'mixed_register', label: '文白夾雜' }
] as const

export const STRUCTURE_SUBTYPES = [
  { id: 'off_topic', label: '離題' },
  { id: 'insufficient_evidence', label: '缺例證' },
  { id: 'paragraph_balance', label: '段落失衡' },
  { id: 'transition', label: '轉折不足' },
  { id: 'intro_outro', label: '首尾' },
  { id: 'unclear_topic', label: '段落主題不明' }
] as const

export const COMMENT_SUBTYPES = [
  { id: 'strength', label: '整體優點' },
  { id: 'weakness', label: '整體待改進' },
  { id: 'mixed', label: '優缺並陳' },
  { id: 'intellectual', label: '知性題' },
  { id: 'emotional', label: '情意題' },
  { id: 'applied', label: '應用文' }
] as const

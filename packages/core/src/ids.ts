/**
 * 資料夾與檔名規則：全部 ASCII，中文只存在 JSON。
 */

export function normalizeSeat(input: string | number): string {
  const digits = String(input).replace(/\D/g, '')
  return digits.padStart(2, '0').slice(-2)
}

export function classFolderId(classNo: string, academicYear: string, semester: 1 | 2): string {
  const term = semester === 1 ? 'F' : 'S'
  return `C${classNo}-${academicYear}${term}`
}

export function assignmentFolderId(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `E${y}${m}${d}`
}

/** 同日撞名時使用：-02、-03…… */
export function assignmentCollisionId(base: string, index: number): string {
  return index <= 1 ? base : `${base}-${String(index).padStart(2, '0')}`
}

export function studentFolderId(seat: string): string {
  return `S${normalizeSeat(seat)}`
}

export function pageFileName(index: number): string {
  return `p${index}.jpg`
}

export function feedbackFileName(seat: string): string {
  return `S${normalizeSeat(seat)}_feedback.pdf`
}

/** 判斷是否為匯入時應忽略的暫存檔。 */
export function isIgnoredFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.endsWith('.tmp') ||
    lower.endsWith('.crdownload') ||
    lower.endsWith('.part') ||
    lower.startsWith('~$') ||
    lower === 'desktop.ini' ||
    lower === 'thumbs.db' ||
    lower.startsWith('.')
  )
}

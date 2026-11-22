import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { loadClass, listAssignments } from '../data/repository'
import { readSettings } from '../data/settings'
import { writeJsonAtomic } from '../data/atomic'

const CLASS_ID_RE = /^C[0-9A-Za-z-]+$/

/** 手機 manifest 的學生項目；只保留手機選單需要的座號與姓名。 */
export interface PhoneManifestStudent {
  seat: string
  name: string
}

export interface PhoneManifestAssignment {
  id: string
  title: string
  students: PhoneManifestStudent[]
}

export interface PhoneManifestClass {
  id: string
  name: string
  grade: string
  assignments: PhoneManifestAssignment[]
}

/**
 * 給手機掃描器讀取的 manifest。
 * 刻意不含分數、批注、總評、更新時間或任何作品內容。
 */
export interface PhoneManifest {
  schema_version: 1
  generated_at: string
  classes: PhoneManifestClass[]
}

export interface PhoneManifestResult {
  path: string
  root: string
  classId: string
  className: string
  classCount: number
  assignmentCount: number
  studentCount: number
}

/**
 * 以目前班級產生外部 inbox 根目錄的 manifest.json。
 * 只包含 active !== false 的學生；覆蓋舊檔時使用原子寫入。
 */
export async function writePhoneManifest(classId: string): Promise<PhoneManifestResult> {
  if (!CLASS_ID_RE.test(classId)) {
    throw new Error('班級代號格式不正確，無法產生 manifest。')
  }

  const settings = await readSettings()
  const root = settings.externalInboxRoot
  if (!root) {
    throw new Error(
      '尚未設定 Google Drive inbox，請先按「設定／變更」選擇 Google Drive 本機同步資料夾。'
    )
  }

  try {
    const info = await stat(root)
    if (!info.isDirectory()) throw new Error('not a directory')
  } catch {
    throw new Error('Google Drive inbox 資料夾不存在，請重新設定後再產生 manifest。')
  }

  const { data: classFile } = await loadClass(classId)
  const assignments = await listAssignments(classId)
  const activeStudents = classFile.students
    .filter((student) => student.active !== false)
    .map((student) => ({ seat: student.seat, name: student.name }))

  const manifest: PhoneManifest = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    classes: [
      {
        id: classFile.id,
        name: classFile.name,
        grade: classFile.grade,
        assignments: assignments.map((assignment) => ({
          id: assignment.id,
          title: assignment.title,
          students: activeStudents
        }))
      }
    ]
  }

  const path = join(root, 'manifest.json')
  await writeJsonAtomic(path, manifest)

  return {
    path,
    root,
    classId: classFile.id,
    className: classFile.name,
    classCount: manifest.classes.length,
    assignmentCount: manifest.classes[0]?.assignments.length ?? 0,
    studentCount: activeStudents.length
  }
}

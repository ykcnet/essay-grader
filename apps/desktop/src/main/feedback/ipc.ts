import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { feedbackExportFileName } from '@essay-grader/core'
import {
  assertFeedbackExportable,
  buildFeedback,
  defaultSavePath,
  exportFeedbackPdf,
  openFeedbackPreview
} from './service'

export function registerFeedbackIpc(): void {
  ipcMain.handle('feedback:load', (_event, classId: string, assignmentId: string, seat: string) =>
    buildFeedback(classId, assignmentId, seat)
  )

  ipcMain.handle(
    'feedback:open',
    (_event, classId: string, assignmentId: string, seat: string) =>
      openFeedbackPreview(classId, assignmentId, seat)
  )

  ipcMain.handle(
    'feedback:export',
    (_event, classId: string, assignmentId: string, seat: string) =>
      exportFeedbackPdf(classId, assignmentId, seat)
  )

  ipcMain.handle(
    'feedback:save-as',
    async (event, classId: string, assignmentId: string, seat: string) => {
      await assertFeedbackExportable(classId, assignmentId, seat)
      const sheet = await buildFeedback(classId, assignmentId, seat)
      const fileName = feedbackExportFileName({
        className: sheet.className,
        title: sheet.title,
        seat: sheet.seat,
        name: sheet.name,
        gradedAt: sheet.gradedAt
      })

      const win = BrowserWindow.fromWebContents(event.sender)
      const options = {
        title: '另存回饋單 PDF',
        defaultPath: defaultSavePath(fileName),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      }
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options)

      if (result.canceled || !result.filePath) {
        return { canceled: true as const }
      }

      const exported = await exportFeedbackPdf(classId, assignmentId, seat, result.filePath)
      return { canceled: false as const, ...exported }
    }
  )

  ipcMain.handle('feedback:print', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false, reason: '找不到列印視窗' }

    return new Promise<{ success: boolean; reason?: string }>((resolve) => {
      win.webContents.print(
        { printBackground: true, silent: false },
        (success, failureReason) => {
          resolve(
            success
              ? { success: true }
              : { success: false, reason: failureReason || '列印已取消' }
          )
        }
      )
    })
  })

  ipcMain.handle('feedback:reveal', (_event, path: string) => {
    shell.showItemInFolder(path)
    return { revealed: true }
  })
}

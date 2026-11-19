import { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { ImportEvent } from '@essay-grader/core'

const MAX_EVENTS = 100

const emitter = new EventEmitter()
const events: ImportEvent[] = []

export async function emitImportEvent(
  partial: Omit<ImportEvent, 'id' | 'at'>
): Promise<void> {
  const event: ImportEvent = { id: randomUUID(), at: new Date().toISOString(), ...partial }
  events.push(event)
  if (events.length > MAX_EVENTS) events.shift()

  emitter.emit('event', event)
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('import:event', event)
  }
}

export function getImportEvents(): ImportEvent[] {
  return [...events]
}

export function onImportEvent(listener: (event: ImportEvent) => void): () => void {
  emitter.on('event', listener)
  return () => emitter.off('event', listener)
}

import { app } from 'electron'
import { join } from 'node:path'

/** 專案根目錄（apps/desktop 往上兩層）。 */
export const repoRoot = join(app.getAppPath(), '..', '..')
export const spikeOutDir = join(repoRoot, 'spike-out')
export const spikeAssetsDir = join(repoRoot, 'spike-assets')
export const spikePagePath = join(spikeAssetsDir, 'page-2600.jpg')
export const markersPath = join(spikeOutDir, 'annotations.json')
export const feedbackPdfPath = join(spikeOutDir, 'feedback.pdf')
export const reportPath = join(spikeOutDir, 'report.json')
export const inboxDir = join(spikeOutDir, 'inbox')

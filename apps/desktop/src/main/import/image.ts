import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface ProcessedImage {
  width: number
  height: number
}

const MAX_LONG_EDGE = 2600
const THUMB_EDGE = 600

/**
 * EXIF 轉正、移除中繼資料（含 GPS）、長邊上限 2600、輸出 JPEG，
 * 另存 600px WebP 縮圖。
 */
export async function preprocessImage(
  source: string,
  target: string,
  thumbnail?: string
): Promise<ProcessedImage> {
  await mkdir(dirname(target), { recursive: true })

  const pipeline = sharp(source, { failOn: 'none' }).rotate()
  const metadata = await pipeline.metadata()
  const longEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0)

  const resized =
    longEdge > MAX_LONG_EDGE
      ? pipeline.resize({
          width: MAX_LONG_EDGE,
          height: MAX_LONG_EDGE,
          fit: 'inside',
          withoutEnlargement: true
        })
      : pipeline

  const info = await resized.jpeg({ quality: 85 }).toFile(target)

  if (thumbnail) {
    await sharp(target)
      .resize({
        width: THUMB_EDGE,
        height: THUMB_EDGE,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: 70 })
      .toFile(thumbnail)
  }

  return { width: info.width, height: info.height }
}

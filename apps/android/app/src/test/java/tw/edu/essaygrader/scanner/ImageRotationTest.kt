package tw.edu.essaygrader.scanner

import org.junit.Assert.assertEquals
import org.junit.Test

class ImageRotationTest {

    @Test
    fun `角度正規化為 0 90 180 270`() {
        assertEquals(0, ImageRotation.normalizeDegrees(0))
        assertEquals(90, ImageRotation.normalizeDegrees(90))
        assertEquals(180, ImageRotation.normalizeDegrees(180))
        assertEquals(270, ImageRotation.normalizeDegrees(270))
        assertEquals(90, ImageRotation.normalizeDegrees(450))
        assertEquals(270, ImageRotation.normalizeDegrees(-90))
        assertEquals(0, ImageRotation.normalizeDegrees(45))
    }

    @Test
    fun `旋轉 90 與 270 度會交換寬高`() {
        assertEquals(700 to 1000, ImageRotation.rotatedSize(700, 1000, 0))
        assertEquals(1000 to 700, ImageRotation.rotatedSize(700, 1000, 90))
        assertEquals(700 to 1000, ImageRotation.rotatedSize(700, 1000, 180))
        assertEquals(1000 to 700, ImageRotation.rotatedSize(700, 1000, 270))
    }

    @Test
    fun `縮圖取樣讓長邊不超過上限`() {
        assertEquals(1, ImageRotation.sampleSizeFor(1000, 800, 1200))
        assertEquals(2, ImageRotation.sampleSizeFor(2000, 1500, 1200))
        assertEquals(4, ImageRotation.sampleSizeFor(4000, 3000, 1200))
        assertEquals(1, ImageRotation.sampleSizeFor(0, 0, 1200))
    }
}

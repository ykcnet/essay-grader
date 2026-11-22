package tw.edu.essaygrader.scanner

/**
 * 頁面旋轉與縮圖取樣的純函式，與 Android 無關，方便 JVM 單元測試。
 */
object ImageRotation {

    /** 正規化為 0／90／180／270；非 90 倍數一律視為 0。 */
    fun normalizeDegrees(degrees: Int): Int {
        val normalized = ((degrees % 360) + 360) % 360
        return if (normalized % 90 == 0) normalized else 0
    }

    /** 旋轉後尺寸；90／270 度會交換寬高。 */
    fun rotatedSize(width: Int, height: Int, degrees: Int): Pair<Int, Int> =
        if (normalizeDegrees(degrees) % 180 == 90) height to width else width to height

    /** 讓長邊不超過 maxLongSide 的 2 的次方 inSampleSize（至少 1）。 */
    fun sampleSizeFor(width: Int, height: Int, maxLongSide: Int): Int {
        if (width <= 0 || height <= 0 || maxLongSide <= 0) return 1
        val longSide = maxOf(width, height)
        var sample = 1
        while (longSide / sample > maxLongSide && sample < MAX_SAMPLE_SIZE) {
            sample *= 2
        }
        return sample
    }

    private const val MAX_SAMPLE_SIZE = 1 shl 10
}

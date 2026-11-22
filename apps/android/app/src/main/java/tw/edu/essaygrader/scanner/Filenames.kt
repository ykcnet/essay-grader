package tw.edu.essaygrader.scanner

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 檔名與時間戳的純函式，與 Android 無關，方便 JVM 單元測試。
 */
object Filenames {

    /** session 編號，例：20261122T143012（本地牆鐘，不含時區）。 */
    fun sessionId(now: Date = Date()): String =
        SimpleDateFormat("yyyyMMdd'T'HHmmss", Locale.US).format(now)

    /** ISO 8601 含時區位移，例：2026-11-22T14:30:12+08:00。 */
    fun capturedAt(now: Date = Date()): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).format(now)

    /** 頁面檔名，例：S07__20261122T143012__001.jpg。 */
    fun pageFileName(seat: String, sessionId: String, seq: Int): String =
        "S${seat}__${sessionId}__${seq.toString().padStart(3, '0')}.jpg"

    /** sidecar 檔名與頁面同名但副檔名為 .json。 */
    fun sidecarFileName(pageFileName: String): String =
        pageFileName.substringBeforeLast('.', pageFileName) + ".json"

    /** 本機 pending 暫存頁面檔名，例：page-001.jpg。 */
    fun pendingPageFileName(seq: Int): String =
        "page-${seq.toString().padStart(3, '0')}.jpg"
}

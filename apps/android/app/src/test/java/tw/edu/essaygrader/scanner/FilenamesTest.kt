package tw.edu.essaygrader.scanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

class FilenamesTest {

    @Test
    fun `頁面檔名格式 S座號__sessionId__三位序號`() {
        assertEquals(
            "S07__20261122T143012__001.jpg",
            Filenames.pageFileName("07", "20261122T143012", 1)
        )
        assertEquals(
            "S07__20261122T143012__012.jpg",
            Filenames.pageFileName("07", "20261122T143012", 12)
        )
        assertEquals(
            "S12__x__100.jpg",
            Filenames.pageFileName("12", "x", 100)
        )
    }

    @Test
    fun `sidecar 檔名與頁面同名但副檔名為 json`() {
        val page = Filenames.pageFileName("07", "20261122T143012", 3)
        assertEquals("S07__20261122T143012__003.json", Filenames.sidecarFileName(page))
    }

    @Test
    fun `sessionId 為本地牆鐘 yyyyMMddTHHmmss`() {
        val cal = Calendar.getInstance().apply {
            set(2026, Calendar.NOVEMBER, 22, 14, 30, 12)
            set(Calendar.MILLISECOND, 0)
        }
        assertEquals("20261122T143012", Filenames.sessionId(cal.time))
    }

    @Test
    fun `capturedAt 為 ISO 8601 含時區位移`() {
        val cal = Calendar.getInstance().apply {
            set(2026, Calendar.NOVEMBER, 22, 14, 30, 12)
            set(Calendar.MILLISECOND, 0)
        }
        val result = Filenames.capturedAt(cal.time)
        assertTrue(
            "capturedAt 應符合 ISO 8601 含時區，實際為 $result",
            Regex("2026-11-22T14:30:12(Z|[+-]\\d{2}:\\d{2})").matches(result)
        )
    }

    @Test
    fun `pending 頁面檔名 page-XXX jpg`() {
        assertEquals("page-001.jpg", Filenames.pendingPageFileName(1))
        assertEquals("page-020.jpg", Filenames.pendingPageFileName(20))
    }
}

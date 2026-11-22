package tw.edu.essaygrader.scanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class PendingMetaTest {

    @Test
    fun `序列化與反序列化可往返`() {
        val meta = PendingMeta(
            classId = "C302-2025F",
            assignmentId = "E20250107",
            seat = "07",
            sessionId = "20261122T143012",
            capturedAt = "2026-11-22T14:30:12+08:00",
            pageCount = 3
        )
        val restored = PendingMeta.fromJson(meta.toJson())
        assertNotNull(restored)
        assertEquals(meta, restored)
    }

    @Test
    fun `非 JSON 或缺少欄位回傳 null`() {
        assertNull(PendingMeta.fromJson("not json"))
        assertNull(PendingMeta.fromJson("""{ "schema_version": 1 }"""))
        assertNull(PendingMeta.fromJson("""{ "class_id": "C1" }"""))
    }
}

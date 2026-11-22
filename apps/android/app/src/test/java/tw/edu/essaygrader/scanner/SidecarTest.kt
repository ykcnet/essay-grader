package tw.edu.essaygrader.scanner

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class SidecarTest {

    @Test
    fun `sidecar 產生正確欄位`() {
        val sidecar = Sidecar(
            classId = "C302-2025F",
            assignmentId = "E20250107",
            seat = "07",
            seq = 1,
            sessionId = "20261122T143012",
            capturedAt = "2026-11-22T14:30:12+08:00"
        )
        val json = JSONObject(sidecar.toJson())
        assertEquals(1, json.getInt("schema_version"))
        assertEquals("C302-2025F", json.getString("class_id"))
        assertEquals("E20250107", json.getString("assignment_id"))
        assertEquals("07", json.getString("seat"))
        assertEquals(1, json.getInt("seq"))
        assertEquals("20261122T143012", json.getString("session_id"))
        assertEquals("2026-11-22T14:30:12+08:00", json.getString("captured_at"))
    }

    @Test
    fun `seq 與 session_id 依參數變化`() {
        val sidecar = Sidecar("C1", "E1", "12", 3, "abc", "2026-11-22T00:00:00Z")
        val json = JSONObject(sidecar.toJson())
        assertEquals(3, json.getInt("seq"))
        assertEquals("abc", json.getString("session_id"))
        assertEquals("12", json.getString("seat"))
    }
}

package tw.edu.essaygrader.scanner

import org.json.JSONObject

/** 每頁圖片旁的 sidecar，桌面端靠它配對班級／作業／座號，不猜檔名。 */
data class Sidecar(
    val classId: String,
    val assignmentId: String,
    val seat: String,
    val seq: Int,
    val sessionId: String,
    val capturedAt: String
) {
    fun toJson(): String = JSONObject()
        .put("schema_version", 1)
        .put("class_id", classId)
        .put("assignment_id", assignmentId)
        .put("seat", seat)
        .put("seq", seq)
        .put("session_id", sessionId)
        .put("captured_at", capturedAt)
        .toString()
}

package tw.edu.essaygrader.scanner

import org.json.JSONObject

/** 本機離線待上傳佇列的工作階段 metadata，存在 pending/<sessionId>/meta.json。 */
data class PendingMeta(
    val classId: String,
    val assignmentId: String,
    val seat: String,
    val sessionId: String,
    val capturedAt: String,
    val pageCount: Int
) {
    fun toJson(): String = JSONObject()
        .put("schema_version", 1)
        .put("class_id", classId)
        .put("assignment_id", assignmentId)
        .put("seat", seat)
        .put("session_id", sessionId)
        .put("captured_at", capturedAt)
        .put("page_count", pageCount)
        .toString()

    companion object {
        fun fromJson(json: String): PendingMeta? = try {
            val obj = JSONObject(json)
            PendingMeta(
                classId = obj.getString("class_id"),
                assignmentId = obj.getString("assignment_id"),
                seat = obj.getString("seat"),
                sessionId = obj.getString("session_id"),
                capturedAt = obj.getString("captured_at"),
                pageCount = obj.getInt("page_count")
            )
        } catch (_: Exception) {
            null
        }
    }
}

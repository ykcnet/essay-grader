package tw.edu.essaygrader.scanner

import org.json.JSONArray
import org.json.JSONObject

data class Student(val seat: String, val name: String, val active: Boolean = true)

data class Assignment(val id: String, val title: String, val students: List<Student>)

data class ClassInfo(val id: String, val name: String, val assignments: List<Assignment>)

data class Manifest(val classes: List<ClassInfo>)

/**
 * 解析桌面端產生的 manifest.json。任何結構缺失視為「格式錯誤」回傳 null，
 * 空 classes 則回傳空 Manifest（由 UI 判斷為「沒有班級資料」）。
 */
object ManifestParser {

    fun parse(json: String): Manifest? = try {
        val root = JSONObject(json)
        val classesArr = root.optJSONArray("classes") ?: return null

        val classes = buildList {
            for (i in 0 until classesArr.length()) {
                val classObj = classesArr.optJSONObject(i) ?: continue
                val classId = classObj.optString("id", "").trim()
                if (classId.isEmpty()) continue
                val className = classObj.optString("name", classId)
                val assignmentsArr = classObj.optJSONArray("assignments") ?: JSONArray()

                val assignments = buildList {
                    for (j in 0 until assignmentsArr.length()) {
                        val assignmentObj = assignmentsArr.optJSONObject(j) ?: continue
                        val assignmentId = assignmentObj.optString("id", "").trim()
                        if (assignmentId.isEmpty()) continue
                        val title = assignmentObj.optString("title", assignmentId)
                        val studentsArr = assignmentObj.optJSONArray("students") ?: JSONArray()

                        val students = buildList {
                            for (k in 0 until studentsArr.length()) {
                                val studentObj = studentsArr.optJSONObject(k) ?: continue
                                val seat = studentObj.optString("seat", "").trim()
                                if (seat.isEmpty()) continue
                                val name = studentObj.optString("name", "")
                                val active = studentObj.optBoolean("active", true)
                                add(Student(seat, name, active))
                            }
                        }
                        add(Assignment(assignmentId, title, students))
                    }
                }
                add(ClassInfo(classId, className, assignments))
            }
        }
        Manifest(classes)
    } catch (_: Exception) {
        null
    }
}

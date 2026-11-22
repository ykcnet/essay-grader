package tw.edu.essaygrader.scanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ManifestParserTest {

    @Test
    fun `正常 manifest 可解析`() {
        val json = """
            {
              "schema_version": 1,
              "generated_at": "2026-11-22T00:00:00Z",
              "classes": [
                {
                  "id": "C302-2025F",
                  "name": "國中302",
                  "assignments": [
                    {
                      "id": "E20250107",
                      "title": "我的母親",
                      "students": [
                        { "seat": "07", "name": "王小明" },
                        { "seat": "08", "name": "李大同", "active": false }
                      ]
                    }
                  ]
                }
              ]
            }
        """.trimIndent()

        val manifest = ManifestParser.parse(json)
        assertNotNull(manifest)
        assertEquals(1, manifest!!.classes.size)

        val cls = manifest.classes[0]
        assertEquals("C302-2025F", cls.id)
        assertEquals("國中302", cls.name)
        assertEquals(1, cls.assignments.size)

        val assignment = cls.assignments[0]
        assertEquals("E20250107", assignment.id)
        assertEquals("我的母親", assignment.title)
        assertEquals(2, assignment.students.size)

        val first = assignment.students[0]
        assertEquals("07", first.seat)
        assertEquals("王小明", first.name)
        assertTrue(first.active)

        val second = assignment.students[1]
        assertFalse(second.active)
    }

    @Test
    fun `缺少 classes 欄位視為格式錯誤`() {
        val json = """{ "schema_version": 1, "generated_at": "2026-11-22T00:00:00Z" }"""
        assertNull(ManifestParser.parse(json))
    }

    @Test
    fun `空 classes 回傳空 Manifest 而非 null`() {
        val json = """{ "schema_version": 1, "classes": [] }"""
        val manifest = ManifestParser.parse(json)
        assertNotNull(manifest)
        assertTrue(manifest!!.classes.isEmpty())
    }

    @Test
    fun `格式錯誤的 JSON 回傳 null`() {
        assertNull(ManifestParser.parse("not json at all"))
        assertNull(ManifestParser.parse(""))
    }
}

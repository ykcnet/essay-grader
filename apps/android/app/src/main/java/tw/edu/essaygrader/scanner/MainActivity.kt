package tw.edu.essaygrader.scanner

import android.app.Activity
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.documentfile.provider.DocumentFile
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

class MainActivity : AppCompatActivity() {

    private lateinit var prefs: SharedPreferences

    private lateinit var driveStatusText: TextView
    private lateinit var pendingStatusText: TextView
    private lateinit var messageText: TextView
    private lateinit var classSpinner: Spinner
    private lateinit var assignmentSpinner: Spinner
    private lateinit var studentSpinner: Spinner

    private lateinit var classAdapter: ArrayAdapter<String>
    private lateinit var assignmentAdapter: ArrayAdapter<String>
    private lateinit var studentAdapter: ArrayAdapter<String>

    private var classes: List<ClassInfo> = emptyList()
    private var assignments: List<Assignment> = emptyList()
    private var students: List<Student> = emptyList()
    private var suppressSpinners = false

    private val driveTreeLauncher =
        registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            onDriveFolderChosen(uri)
        }

    private val scannerLauncher =
        registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
            if (result.resultCode == Activity.RESULT_OK) {
                val scanResult = GmsDocumentScanningResult.fromActivityResultIntent(result.data)
                val pages = scanResult?.pages
                if (pages.isNullOrEmpty()) {
                    showMessage(getString(R.string.msg_scan_empty))
                } else {
                    handleScannedPages(pages)
                }
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)

        driveStatusText = findViewById(R.id.driveStatusText)
        pendingStatusText = findViewById(R.id.pendingStatusText)
        messageText = findViewById(R.id.messageText)
        classSpinner = findViewById(R.id.classSpinner)
        assignmentSpinner = findViewById(R.id.assignmentSpinner)
        studentSpinner = findViewById(R.id.studentSpinner)

        setupSpinners()

        findViewById<MaterialButton>(R.id.chooseDriveButton).setOnClickListener { chooseDriveFolder() }
        findViewById<MaterialButton>(R.id.reloadManifestButton).setOnClickListener { reloadManifest() }
        findViewById<MaterialButton>(R.id.scanButton).setOnClickListener { startScan() }
        findViewById<MaterialButton>(R.id.retryUploadButton).setOnClickListener { retryPendingUploads() }

        updateDriveStatus()
        updatePendingStatus()
        if (prefs.contains(KEY_DRIVE_URI)) {
            reloadManifest()
        }
    }

    // -------------------------------------------------------------------------
    // UI 初始化
    // -------------------------------------------------------------------------

    private fun setupSpinners() {
        classAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, mutableListOf<String>())
        classAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        classSpinner.adapter = classAdapter

        assignmentAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, mutableListOf<String>())
        assignmentAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        assignmentSpinner.adapter = assignmentAdapter

        studentAdapter = ArrayAdapter(this, android.R.layout.simple_spinner_item, mutableListOf<String>())
        studentAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        studentSpinner.adapter = studentAdapter

        classSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (!suppressSpinners) refreshAssignments()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
        assignmentSpinner.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (!suppressSpinners) refreshStudents()
            }

            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }
    }

    // -------------------------------------------------------------------------
    // Drive 資料夾
    // -------------------------------------------------------------------------

    private fun chooseDriveFolder() {
        driveTreeLauncher.launch(null)
    }

    private fun onDriveFolderChosen(uri: Uri?) {
        if (uri == null) return
        try {
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        } catch (_: SecurityException) {
            // 部分 provider 不支援 persistent grant，仍可於本次執行期間使用
        }
        prefs.edit().putString(KEY_DRIVE_URI, uri.toString()).apply()
        updateDriveStatus()
        reloadManifest()
    }

    private fun updateDriveStatus() {
        val uriStr = prefs.getString(KEY_DRIVE_URI, null)
        if (uriStr == null) {
            driveStatusText.text = getString(R.string.drive_not_set)
            return
        }
        val name = try {
            DocumentFile.fromTreeUri(this, Uri.parse(uriStr))?.name
        } catch (_: Exception) {
            null
        }
        driveStatusText.text = name ?: getString(R.string.drive_folder_placeholder)
    }

    // -------------------------------------------------------------------------
    // Manifest 讀取與 Spinner 連動
    // -------------------------------------------------------------------------

    private fun reloadManifest() {
        val uriStr = prefs.getString(KEY_DRIVE_URI, null)
        if (uriStr == null) {
            showMessage(getString(R.string.msg_select_drive_first))
            return
        }
        val treeUri = Uri.parse(uriStr)
        lifecycleScope.launch {
            val result = loadManifestFromDrive(treeUri)
            if (result.manifest != null) {
                classes = result.manifest.classes
                populateClassSpinner()
                showMessage(getString(R.string.msg_manifest_loaded, classes.size))
            } else {
                showMessage(result.error ?: getString(R.string.msg_manifest_bad_format))
            }
        }
    }

    private suspend fun loadManifestFromDrive(treeUri: Uri): LoadResult = withContext(Dispatchers.IO) {
        try {
            val root = DocumentFile.fromTreeUri(this@MainActivity, treeUri)
                ?: return@withContext LoadResult(error = getString(R.string.msg_manifest_missing))
            val file = root.findFile("manifest.json")
                ?: return@withContext LoadResult(error = getString(R.string.msg_manifest_missing))
            val input = contentResolver.openInputStream(file.uri)
                ?: return@withContext LoadResult(error = getString(R.string.msg_manifest_unreadable))
            val text = input.bufferedReader().use { it.readText() }
            val manifest = ManifestParser.parse(text)
                ?: return@withContext LoadResult(error = getString(R.string.msg_manifest_bad_format))
            if (manifest.classes.isEmpty()) {
                return@withContext LoadResult(error = getString(R.string.msg_manifest_empty))
            }
            LoadResult(manifest = manifest)
        } catch (_: Exception) {
            LoadResult(error = getString(R.string.msg_manifest_unreadable))
        }
    }

    private fun populateClassSpinner() {
        suppressSpinners = true
        classAdapter.clear()
        if (classes.isNotEmpty()) {
            classAdapter.addAll(classes.map { getString(R.string.class_label_fmt, it.name, it.id) })
        }
        classAdapter.notifyDataSetChanged()
        if (classes.isNotEmpty()) classSpinner.setSelection(0)
        suppressSpinners = false
        refreshAssignments()
    }

    private fun refreshAssignments() {
        assignments = currentClass()?.assignments ?: emptyList()
        suppressSpinners = true
        assignmentAdapter.clear()
        if (assignments.isNotEmpty()) {
            assignmentAdapter.addAll(assignments.map { it.title })
        }
        assignmentAdapter.notifyDataSetChanged()
        if (assignments.isNotEmpty()) assignmentSpinner.setSelection(0)
        suppressSpinners = false
        refreshStudents()
    }

    private fun refreshStudents() {
        students = currentAssignment()?.students?.filter { it.active } ?: emptyList()
        suppressSpinners = true
        studentAdapter.clear()
        if (students.isNotEmpty()) {
            studentAdapter.addAll(students.map { getString(R.string.student_label_fmt, it.seat, it.name) })
        }
        studentAdapter.notifyDataSetChanged()
        if (students.isNotEmpty()) studentSpinner.setSelection(0)
        suppressSpinners = false
    }

    private fun currentClass(): ClassInfo? = classes.getOrNull(classSpinner.selectedItemPosition)

    private fun currentAssignment(): Assignment? = assignments.getOrNull(assignmentSpinner.selectedItemPosition)

    private fun currentStudent(): Student? = students.getOrNull(studentSpinner.selectedItemPosition)

    // -------------------------------------------------------------------------
    // 掃描
    // -------------------------------------------------------------------------

    private fun startScan() {
        if (prefs.getString(KEY_DRIVE_URI, null) == null) {
            showMessage(getString(R.string.msg_select_drive_first))
            return
        }
        if (currentClass() == null) {
            showMessage(getString(R.string.msg_select_class))
            return
        }
        if (currentAssignment() == null) {
            showMessage(getString(R.string.msg_select_assignment))
            return
        }
        if (currentStudent() == null) {
            showMessage(getString(R.string.msg_select_student))
            return
        }

        val options = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(false)
            .setPageLimit(20)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build()

        try {
            val scanner = GmsDocumentScanning.getClient(options)
            scanner.getStartScanIntent(this)
                .addOnSuccessListener { intentSender ->
                    scannerLauncher.launch(IntentSenderRequest.Builder(intentSender).build())
                }
                .addOnFailureListener {
                    showMessage(getString(R.string.msg_scanner_unsupported))
                }
        } catch (_: Exception) {
            showMessage(getString(R.string.msg_scanner_unsupported))
        }
    }

    private fun handleScannedPages(pages: List<GmsDocumentScanningResult.Page>) {
        val classInfo = currentClass() ?: return
        val assignment = currentAssignment() ?: return
        val student = currentStudent() ?: return
        val sessionId = Filenames.sessionId()
        val capturedAt = Filenames.capturedAt()

        lifecycleScope.launch {
            val saved = withContext(Dispatchers.IO) {
                savePending(classInfo.id, assignment.id, student.seat, sessionId, capturedAt, pages)
            }
            if (!saved) {
                showMessage(getString(R.string.msg_scan_save_failed))
                return@launch
            }
            showMessage(getString(R.string.msg_scan_saved, pages.size))
            updatePendingStatus()
            uploadSession(sessionId)
        }
    }

    private fun savePending(
        classId: String,
        assignmentId: String,
        seat: String,
        sessionId: String,
        capturedAt: String,
        pages: List<GmsDocumentScanningResult.Page>
    ): Boolean {
        return try {
        val dir = File(filesDir, "pending/$sessionId")
        if (!dir.exists() && !dir.mkdirs()) return false
        for (i in pages.indices) {
            val seq = i + 1
            val input = contentResolver.openInputStream(pages[i].imageUri) ?: return false
            val target = File(dir, Filenames.pendingPageFileName(seq))
            input.use { ins ->
                FileOutputStream(target).use { outs -> copyStream(ins, outs) }
            }
        }
        val meta = PendingMeta(classId, assignmentId, seat, sessionId, capturedAt, pages.size)
        File(dir, "meta.json").writeText(meta.toJson(), Charsets.UTF_8)
        true
        } catch (_: Exception) {
            false
        }
    }

    // -------------------------------------------------------------------------
    // 上傳到 Drive inbox
    // -------------------------------------------------------------------------

    private suspend fun uploadSession(sessionId: String) {
        val result = withContext(Dispatchers.IO) { attemptUpload(sessionId) }
        updatePendingStatus()
        when {
            result.isFullSuccess -> showMessage(getString(R.string.msg_uploaded_pages, result.successCount))
            result.successCount > 0 -> showMessage(
                getString(R.string.msg_partial_upload, result.successCount, result.failureCount)
            )
            else -> showMessage(getString(R.string.msg_upload_failed, result.error ?: ""))
        }
    }

    private fun attemptUpload(sessionId: String): UploadResult {
        return try {
        val dir = File(filesDir, "pending/$sessionId")
        val metaFile = File(dir, "meta.json")
        if (!metaFile.exists()) return UploadResult.failure("找不到待上傳資料")
        val meta = PendingMeta.fromJson(metaFile.readText(Charsets.UTF_8))
            ?: return UploadResult.failure("待上傳資料損壞")

        val uriStr = prefs.getString(KEY_DRIVE_URI, null)
            ?: return UploadResult.failure(getString(R.string.msg_select_drive_first))
        val treeUri = Uri.parse(uriStr)
        val root = DocumentFile.fromTreeUri(this, treeUri)
            ?: return UploadResult.failure("無法存取 Drive 資料夾（可能權限已失效）")

        val classDir = root.findFile(meta.classId)
            ?: root.createDirectory(meta.classId)
            ?: return UploadResult.failure("無法建立班級資料夾")
        val assignmentDir = classDir.findFile(meta.assignmentId)
            ?: classDir.createDirectory(meta.assignmentId)
            ?: return UploadResult.failure("無法建立作業資料夾")

        var success = 0
        var failure = 0
        var lastError = ""
        for (seq in 1..meta.pageCount) {
            try {
                uploadPage(assignmentDir, dir, meta, seq)
                success++
            } catch (e: Exception) {
                failure++
                lastError = e.message ?: "寫入失敗"
            }
        }

        if (failure == 0) {
            dir.deleteRecursively()
            UploadResult(success, 0, meta.pageCount)
        } else {
            UploadResult(success, failure, meta.pageCount, lastError)
        }
        } catch (e: Exception) {
            UploadResult.failure(e.message ?: "上傳失敗")
        }
    }

    private fun uploadPage(assignmentDir: DocumentFile, pendingDir: File, meta: PendingMeta, seq: Int) {
        val pageFileName = Filenames.pageFileName(meta.seat, meta.sessionId, seq)
        val sidecarName = Filenames.sidecarFileName(pageFileName)

        val imageDoc = assignmentDir.findFile(pageFileName)
            ?: assignmentDir.createFile("image/jpeg", pageFileName)
            ?: throw IOException("無法建立檔案")
        val pendingFile = File(pendingDir, Filenames.pendingPageFileName(seq))
        FileInputStream(pendingFile).use { ins ->
            val out = contentResolver.openOutputStream(imageDoc.uri, "w")
                ?: throw IOException("無法寫入 $pageFileName")
            out.use { outs -> copyStream(ins, outs) }
        }

        val sidecarDoc = assignmentDir.findFile(sidecarName)
            ?: assignmentDir.createFile("application/json", sidecarName)
            ?: throw IOException("無法建立 sidecar")
        val sidecar = Sidecar(
            meta.classId,
            meta.assignmentId,
            meta.seat,
            seq,
            meta.sessionId,
            meta.capturedAt
        )
        val out = contentResolver.openOutputStream(sidecarDoc.uri, "w")
            ?: throw IOException("無法寫入 $sidecarName")
        out.use { it.write(sidecar.toJson().toByteArray(Charsets.UTF_8)) }
    }

    private fun retryPendingUploads() {
        lifecycleScope.launch {
            val dir = File(filesDir, "pending")
            val sessions = withContext(Dispatchers.IO) {
                dir.listFiles()?.filter { it.isDirectory } ?: emptyList()
            }
            if (sessions.isEmpty()) {
                showMessage(getString(R.string.msg_no_pending))
                return@launch
            }
            var uploaded = 0
            var remainingSessions = 0
            for (session in sessions) {
                val result = withContext(Dispatchers.IO) { attemptUpload(session.name) }
                if (result.isFullSuccess) {
                    uploaded += result.successCount
                } else {
                    remainingSessions++
                }
            }
            updatePendingStatus()
            showMessage(getString(R.string.msg_retry_done, uploaded, remainingSessions))
        }
    }

    // -------------------------------------------------------------------------
    // 待上傳狀態
    // -------------------------------------------------------------------------

    private fun updatePendingStatus() {
        lifecycleScope.launch {
            val pages = withContext(Dispatchers.IO) { countPendingPages() }
            pendingStatusText.text = if (pages > 0) {
                getString(R.string.pending_status_fmt, pages)
            } else {
                getString(R.string.pending_status)
            }
        }
    }

    private fun countPendingPages(): Int {
        val dir = File(filesDir, "pending")
        val sessions = dir.listFiles()?.filter { it.isDirectory } ?: return 0
        var total = 0
        for (session in sessions) {
            val metaFile = File(session, "meta.json")
            val meta = if (metaFile.exists()) {
                runCatching { PendingMeta.fromJson(metaFile.readText(Charsets.UTF_8)) }.getOrNull()
            } else {
                null
            }
            total += meta?.pageCount ?: (session.listFiles()?.count {
                it.name.startsWith("page-") && it.name.endsWith(".jpg")
            } ?: 0)
        }
        return total
    }

    // -------------------------------------------------------------------------
    // 工具
    // -------------------------------------------------------------------------

    private fun showMessage(text: String) {
        messageText.text = text
    }

    private data class LoadResult(val manifest: Manifest? = null, val error: String? = null)

    private data class UploadResult(
        val successCount: Int,
        val failureCount: Int,
        val total: Int,
        val error: String? = null
    ) {
        val isFullSuccess: Boolean get() = failureCount == 0 && total > 0

        companion object {
            fun failure(message: String) = UploadResult(0, 1, 1, message)
        }
    }

    companion object {
        private const val PREFS_NAME = "scanner_prefs"
        private const val KEY_DRIVE_URI = "drive_tree_uri"
    }
}

private fun copyStream(input: InputStream, output: OutputStream) {
    val buffer = ByteArray(8192)
    while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        output.write(buffer, 0, read)
    }
    output.flush()
}

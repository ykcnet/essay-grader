package tw.edu.essaygrader.scanner

import android.app.Activity
import android.content.Intent
import android.content.SharedPreferences
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.view.ViewTreeObserver
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.documentfile.provider.DocumentFile
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.snackbar.Snackbar
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
    private lateinit var manifestStatusText: TextView
    private lateinit var pendingStatusText: TextView
    private lateinit var messageText: TextView
    private lateinit var mainScroll: ScrollView
    private lateinit var classLabel: TextView
    private lateinit var classSpinner: Spinner
    private lateinit var assignmentSpinner: Spinner
    private lateinit var studentSpinner: Spinner

    private lateinit var setupPanel: View
    private lateinit var setupSummaryText: TextView
    private lateinit var toggleSetupButton: MaterialButton

    private var snackbar: Snackbar? = null

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

    private val manifestFileLauncher =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            onManifestFileChosen(uri)
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
        manifestStatusText = findViewById(R.id.manifestStatusText)
        pendingStatusText = findViewById(R.id.pendingStatusText)
        messageText = findViewById(R.id.messageText)
        mainScroll = findViewById(R.id.mainScroll)
        classLabel = findViewById(R.id.classLabel)
        classSpinner = findViewById(R.id.classSpinner)
        assignmentSpinner = findViewById(R.id.assignmentSpinner)
        studentSpinner = findViewById(R.id.studentSpinner)
        setupPanel = findViewById(R.id.setupPanel)
        setupSummaryText = findViewById(R.id.setupSummaryText)
        toggleSetupButton = findViewById(R.id.toggleSetupButton)

        setupSpinners()

        findViewById<MaterialButton>(R.id.chooseDriveButton).setOnClickListener { chooseDriveFolder() }
        findViewById<MaterialButton>(R.id.reloadManifestButton).setOnClickListener { reloadManifest() }
        findViewById<MaterialButton>(R.id.chooseManifestButton).setOnClickListener { chooseManifestFile() }
        findViewById<MaterialButton>(R.id.scanButton).setOnClickListener { startScan() }
        findViewById<MaterialButton>(R.id.retryUploadButton).setOnClickListener { retryPendingUploads() }
        toggleSetupButton.setOnClickListener { expandSetupFromSummary() }

        updateDriveStatus()
        updateManifestStatus()
        updatePendingStatus()
        if (prefs.contains(KEY_MANIFEST_URI) || prefs.contains(KEY_DRIVE_URI)) {
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
        expandSetup()
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
        driveStatusText.text = currentDriveName() ?: getString(R.string.drive_folder_placeholder)
    }

    private fun currentDriveName(): String? {
        val uriStr = prefs.getString(KEY_DRIVE_URI, null) ?: return null
        return try {
            DocumentFile.fromTreeUri(this, Uri.parse(uriStr))?.name
        } catch (_: Exception) {
            null
        }
    }

    // -------------------------------------------------------------------------
    // manifest.json 直接選檔
    // -------------------------------------------------------------------------

    private fun chooseManifestFile() {
        expandSetup()
        manifestFileLauncher.launch(arrayOf("application/json", "text/plain", "*/*"))
    }

    private fun onManifestFileChosen(uri: Uri?) {
        if (uri == null) return
        try {
            contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            )
        } catch (_: SecurityException) {
            // 部分 provider 不支援 persistent grant，本次執行期間仍可讀取
        }
        val fallbackName = uri.lastPathSegment?.substringAfterLast('/')
            ?.takeIf { it.isNotBlank() }
            ?: getString(R.string.manifest_file_placeholder)
        prefs.edit()
            .putString(KEY_MANIFEST_URI, uri.toString())
            .putString(KEY_MANIFEST_NAME, fallbackName)
            .apply()
        updateManifestStatus()

        // 檔名查詢可能涉及 Drive 網路，放到背景再更新狀態
        lifecycleScope.launch {
            val resolved = withContext(Dispatchers.IO) { resolveDisplayName(uri) }
            if (prefs.getString(KEY_MANIFEST_URI, null) == uri.toString()) {
                prefs.edit().putString(KEY_MANIFEST_NAME, resolved).apply()
                updateManifestStatus()
                refreshSetupSummaryIfCollapsed()
            }
        }
        reloadManifest()
    }

    private fun updateManifestStatus() {
        manifestStatusText.text = if (prefs.getString(KEY_MANIFEST_URI, null).isNullOrEmpty()) {
            getString(R.string.manifest_not_set)
        } else {
            getString(R.string.manifest_selected_fmt, currentManifestName())
        }
    }

    private fun currentManifestName(): String {
        val uriStr = prefs.getString(KEY_MANIFEST_URI, null)
        val stored = prefs.getString(KEY_MANIFEST_NAME, null)?.takeIf { it.isNotBlank() }
        if (!stored.isNullOrEmpty()) return stored
        if (!uriStr.isNullOrEmpty()) {
            Uri.parse(uriStr).lastPathSegment?.substringAfterLast('/')
                ?.takeIf { it.isNotBlank() }
                ?.let { return it }
        }
        return getString(R.string.manifest_file_placeholder)
    }

    private fun resolveDisplayName(uri: Uri): String {
        val queried = runCatching {
            contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME),
                null,
                null,
                null
            )?.use { cursor ->
                if (!cursor.moveToFirst()) return@use null
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index < 0) null else cursor.getString(index)?.trim()?.takeIf { it.isNotEmpty() }
            }
        }.getOrNull()
        if (queried != null) return queried

        return runCatching { DocumentFile.fromSingleUri(this, uri)?.name }.getOrNull()
            ?.takeIf { it.isNotBlank() }
            ?: uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() }
            ?: getString(R.string.manifest_file_placeholder)
    }

    private fun clearSelectedManifest() {
        val uriStr = prefs.getString(KEY_MANIFEST_URI, null)
        prefs.edit()
            .remove(KEY_MANIFEST_URI)
            .remove(KEY_MANIFEST_NAME)
            .apply()
        if (uriStr != null) {
            try {
                contentResolver.releasePersistableUriPermission(
                    Uri.parse(uriStr),
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (_: SecurityException) {
                // 權限已失效時無需再釋放
            }
        }
        updateManifestStatus()
    }

    // -------------------------------------------------------------------------
    // Manifest 讀取與 Spinner 連動
    // -------------------------------------------------------------------------

    private fun reloadManifest() {
        expandSetup()
        lifecycleScope.launch {
            val manifestUriStr = prefs.getString(KEY_MANIFEST_URI, null)
            var directError: String? = null
            var permissionLost = false

            if (manifestUriStr != null) {
                val direct = loadManifestFromUri(Uri.parse(manifestUriStr))
                if (direct.manifest != null) {
                    applyManifest(direct.manifest)
                    showMessage(getString(R.string.msg_manifest_loaded, direct.manifest.classes.size))
                    return@launch
                }
                directError = direct.error ?: getString(R.string.msg_manifest_unreadable)
                permissionLost = direct.permissionLost
                if (permissionLost) clearSelectedManifest()
            }

            val treeUriStr = prefs.getString(KEY_DRIVE_URI, null)
            if (treeUriStr == null) {
                val message = when {
                    manifestUriStr == null -> getString(R.string.msg_manifest_no_source)
                    permissionLost -> getString(R.string.msg_manifest_permission_lost_no_folder)
                    else -> getString(
                        R.string.msg_manifest_direct_failed_no_folder,
                        directError ?: getString(R.string.msg_manifest_unreadable)
                    )
                }
                showMessage(message)
                return@launch
            }

            val folder = loadManifestFromDriveFolder(Uri.parse(treeUriStr))
            if (folder.manifest != null) {
                applyManifest(folder.manifest)
                val message = when {
                    permissionLost -> getString(
                        R.string.msg_manifest_loaded_permission_lost,
                        folder.manifest.classes.size
                    )
                    directError != null -> getString(
                        R.string.msg_manifest_loaded_folder_fallback,
                        folder.manifest.classes.size,
                        directError
                    )
                    else -> getString(R.string.msg_manifest_loaded, folder.manifest.classes.size)
                }
                showMessage(message)
                return@launch
            }

            val folderError = folder.error ?: getString(R.string.msg_manifest_unreadable)
            val message = when {
                manifestUriStr == null -> getString(
                    R.string.msg_manifest_folder_failed_hint,
                    folderError
                )
                permissionLost -> getString(
                    R.string.msg_manifest_permission_lost_fallback_failed,
                    folderError
                )
                else -> getString(
                    R.string.msg_manifest_both_failed,
                    directError ?: getString(R.string.msg_manifest_unreadable),
                    folderError
                )
            }
            showMessage(message)
        }
    }

    private fun applyManifest(manifest: Manifest) {
        classes = manifest.classes
        populateClassSpinner()
        collapseSetup()
        scrollToClassSection()
    }

    // -------------------------------------------------------------------------
    // 設定區收合／展開
    // -------------------------------------------------------------------------

    private fun collapseSetup() {
        setupSummaryText.text = buildSetupSummary()
        setupPanel.visibility = View.GONE
        setupSummaryText.visibility = View.VISIBLE
        toggleSetupButton.visibility = View.VISIBLE
    }

    private fun expandSetup() {
        setupPanel.visibility = View.VISIBLE
        setupSummaryText.visibility = View.GONE
        toggleSetupButton.visibility = View.GONE
    }

    private fun expandSetupFromSummary() {
        expandSetup()
        mainScroll.smoothScrollTo(0, 0)
    }

    private fun buildSetupSummary(): String {
        val manifestName = currentManifestName()
        return if (prefs.getString(KEY_DRIVE_URI, null) == null) {
            getString(R.string.setup_summary_no_drive_fmt, manifestName, classes.size)
        } else {
            getString(
                R.string.setup_summary_fmt,
                driveStatusText.text.toString(),
                manifestName,
                classes.size
            )
        }
    }

    private fun refreshSetupSummaryIfCollapsed() {
        if (setupPanel.visibility != View.VISIBLE) {
            setupSummaryText.text = buildSetupSummary()
        }
    }

    private fun scrollToClassSection() {
        mainScroll.viewTreeObserver.addOnGlobalLayoutListener(
            object : ViewTreeObserver.OnGlobalLayoutListener {
                override fun onGlobalLayout() {
                    mainScroll.viewTreeObserver.removeOnGlobalLayoutListener(this)
                    val offset = (8 * resources.displayMetrics.density).toInt()
                    val target = (classLabel.top - offset).coerceAtLeast(0)
                    mainScroll.smoothScrollTo(0, target)
                }
            }
        )
    }

    private suspend fun loadManifestFromUri(uri: Uri): ManifestLoadResult =
        withContext(Dispatchers.IO) {
            try {
                val input = contentResolver.openInputStream(uri)
                    ?: return@withContext ManifestLoadResult(
                        error = getString(R.string.msg_manifest_unreadable)
                    )
                val text = input.bufferedReader(Charsets.UTF_8).use { it.readText() }
                parseManifestText(text)
            } catch (e: Exception) {
                ManifestLoadResult(
                    error = getString(R.string.msg_manifest_unreadable),
                    permissionLost = isPermissionError(e)
                )
            }
        }

    private suspend fun loadManifestFromDriveFolder(treeUri: Uri): ManifestLoadResult =
        withContext(Dispatchers.IO) {
            try {
                val root = DocumentFile.fromTreeUri(this@MainActivity, treeUri)
                    ?: return@withContext ManifestLoadResult(
                        error = getString(R.string.msg_drive_folder_unreadable)
                    )
                val children = try {
                    root.listFiles().toList()
                } catch (_: Exception) {
                    return@withContext ManifestLoadResult(
                        error = getString(R.string.msg_drive_folder_unreadable)
                    )
                }
                val file = children.firstOrNull {
                    it.name?.equals(MANIFEST_FILE_NAME, ignoreCase = true) == true
                } ?: return@withContext ManifestLoadResult(
                    error = describeFolderWithoutManifest(children)
                )

                val input = contentResolver.openInputStream(file.uri)
                    ?: return@withContext ManifestLoadResult(
                        error = getString(R.string.msg_manifest_unreadable)
                    )
                val text = input.bufferedReader(Charsets.UTF_8).use { it.readText() }
                parseManifestText(text)
            } catch (_: Exception) {
                ManifestLoadResult(error = getString(R.string.msg_manifest_unreadable))
            }
        }

    private fun parseManifestText(text: String): ManifestLoadResult {
        val manifest = ManifestParser.parse(text)
            ?: return ManifestLoadResult(error = getString(R.string.msg_manifest_bad_format))
        if (manifest.classes.isEmpty()) {
            return ManifestLoadResult(error = getString(R.string.msg_manifest_empty))
        }
        return ManifestLoadResult(manifest = manifest)
    }

    private fun describeFolderWithoutManifest(children: List<DocumentFile>): String {
        if (children.isEmpty()) {
            return getString(R.string.msg_manifest_folder_empty)
        }
        val names = children
            .mapNotNull { it.name?.trim()?.takeIf(String::isNotEmpty) }
            .sorted()
            .take(10)
        return if (names.isEmpty()) {
            getString(R.string.msg_manifest_folder_missing_count_fmt, children.size)
        } else {
            getString(
                R.string.msg_manifest_folder_missing_fmt,
                children.size,
                names.joinToString("、")
            )
        }
    }

    private fun isPermissionError(e: Exception): Boolean {
        if (e is SecurityException) return true
        val message = e.message ?: return false
        return message.contains("permission", ignoreCase = true) ||
            message.contains("denied", ignoreCase = true) ||
            message.contains("權限")
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
        snackbar?.dismiss()
        snackbar = Snackbar.make(mainScroll, text, Snackbar.LENGTH_LONG).also { it.show() }
    }

    private data class ManifestLoadResult(
        val manifest: Manifest? = null,
        val error: String? = null,
        val permissionLost: Boolean = false
    )

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
        private const val KEY_MANIFEST_URI = "manifest_uri"
        private const val KEY_MANIFEST_NAME = "manifest_name"
        private const val MANIFEST_FILE_NAME = "manifest.json"
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

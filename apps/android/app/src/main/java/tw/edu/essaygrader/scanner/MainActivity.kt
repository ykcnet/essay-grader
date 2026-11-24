package tw.edu.essaygrader.scanner

import android.app.Activity
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.ExifInterface
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Log
import android.view.LayoutInflater
import android.view.View
import android.view.ViewTreeObserver
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.ImageView
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.Spinner
import android.widget.TextView
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.documentfile.provider.DocumentFile
import androidx.lifecycle.lifecycleScope
import com.google.android.material.button.MaterialButton
import com.google.android.material.snackbar.Snackbar
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import kotlin.math.abs
import kotlin.math.roundToInt

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

    private val sensorManager by lazy {
        getSystemService(SENSOR_SERVICE) as SensorManager
    }
    private var lastGravity: FloatArray? = null
    private val gravityListener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
            lastGravity = event.values.clone()
        }

        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
    }

    private var rosterScanMode = false
    private var rosterRecognizerCreated = false
    private val rosterRecognizer by lazy {
        rosterRecognizerCreated = true
        TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
    }

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
                if (rosterScanMode) {
                    rosterScanMode = false
                    if (pages.isNullOrEmpty()) {
                        showMessage(getString(R.string.msg_scan_empty))
                    } else {
                        handleRosterPages(pages)
                    }
                } else {
                    handleScanPages(pages)
                }
            } else {
                rosterScanMode = false
            }
        }

    /** 空頁與正常頁面的共用入口；debug 版可長按「開始掃描」模擬 0 頁。 */
    private fun handleScanPages(pages: List<GmsDocumentScanningResult.Page>?) {
        if (pages.isNullOrEmpty()) {
            showMessage(getString(R.string.msg_scan_empty))
            return
        }
        handleScannedPages(pages)
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
        findViewById<MaterialButton>(R.id.scanRosterButton).setOnClickListener { startRosterScan() }
        findViewById<MaterialButton>(R.id.helpButton).setOnClickListener { showHelpDialog() }
        if (BuildConfig.DEBUG) {
            // 測試用：長按「開始掃描」模擬 ML Kit 回傳 0 頁。
            findViewById<MaterialButton>(R.id.scanButton).setOnLongClickListener {
                handleScanPages(emptyList())
                true
            }
        }
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

    override fun onResume() {
        super.onResume()
        sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let {
            sensorManager.registerListener(gravityListener, it, SensorManager.SENSOR_DELAY_NORMAL)
        }
    }

    override fun onDestroy() {
        if (rosterRecognizerCreated) rosterRecognizer.close()
        super.onDestroy()
    }

    override fun onPause() {
        sensorManager.unregisterListener(gravityListener)
        super.onPause()
    }

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

        if (isHoldingLandscape()) {
            AlertDialog.Builder(this)
                .setTitle(R.string.scan_orientation_warning_title)
                .setMessage(R.string.scan_orientation_warning_message)
                .setPositiveButton(R.string.scan_orientation_continue) { _, _ -> launchScanner() }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
            return
        }
        launchScanner()
    }

    /** 以重力感測判斷手機是否明顯橫向；平放桌面時不判定。 */
    private fun isHoldingLandscape(): Boolean {
        val gravity = lastGravity ?: return false
        return abs(gravity[0]) > abs(gravity[1]) * 1.2f
    }

    private fun startRosterScan() {
        if (prefs.getString(KEY_DRIVE_URI, null) == null) {
            showMessage(getString(R.string.msg_select_drive_first))
            return
        }
        if (currentClass() == null) {
            showMessage(getString(R.string.msg_select_class))
            return
        }
        rosterScanMode = true
        launchScanner()
    }

    private fun launchScanner() {
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
                    rosterScanMode = false
                    showMessage(getString(R.string.msg_scanner_unsupported))
                }
        } catch (_: Exception) {
            rosterScanMode = false
            showMessage(getString(R.string.msg_scanner_unsupported))
        }
    }

    private fun handleScannedPages(pages: List<GmsDocumentScanningResult.Page>) {
        val classInfo = currentClass() ?: return
        val assignment = currentAssignment() ?: return
        val student = currentStudent() ?: return
        showRotationDialog(pages, classInfo.id, assignment.id, student.seat)
    }

    // -------------------------------------------------------------------------
    // 名條掃描建檔
    // -------------------------------------------------------------------------

    private fun handleRosterPages(pages: List<GmsDocumentScanningResult.Page>) {
        val classInfo = currentClass() ?: return
        lifecycleScope.launch {
            val text = withContext(Dispatchers.IO) {
                runCatching { recognizeRosterText(pages) }.getOrNull()
            }
            if (text == null) {
                showMessage(getString(R.string.roster_ocr_failed, "無法讀取頁面"))
                return@launch
            }
            val students = parseRosterLines(text)
            Log.i(UPLOAD_LOG_TAG, "roster ocr=${text.take(600)} parsed=${students.size}")
            showRosterEditor(students, classInfo, text)
        }
    }

    private suspend fun recognizeRosterText(
        pages: List<GmsDocumentScanningResult.Page>
    ): String {
        val builder = StringBuilder()
        for (page in pages) {
            val bitmap = decodeForOcr(page.imageUri) ?: continue
            try {
                val text = suspendCancellableCoroutine { continuation ->
                    rosterRecognizer.process(InputImage.fromBitmap(bitmap, 0))
                        .addOnSuccessListener {
                            if (continuation.isActive) continuation.resume(it.text)
                        }
                        .addOnFailureListener {
                            if (continuation.isActive) continuation.resume("")
                        }
                }
                builder.append(text).append('\n')
            } finally {
                if (!bitmap.isRecycled) bitmap.recycle()
            }
        }
        return builder.toString()
    }

    /** 解析「座號 姓名」行；容忍表格拆行、字間空白與常見分隔符。 */
    private fun parseRosterLines(text: String): List<Pair<String, String>> {
        val bySeat = LinkedHashMap<String, String>()
        val inline = Regex(
            "^(\\d{1,2})\\s*[.、,，:：\\-]?\\s*([\\u4e00-\\u9fff]{1,10})\\s*$"
        )
        val loose = Regex("(\\d{1,2})\\s*[.、,，:：\\-]?\\s*([\\u4e00-\\u9fff]{2,10})")
        var pendingSeat: String? = null

        for (raw in text.lines()) {
            val line = raw.replace('\u3000', ' ').trim()
            if (line.isEmpty()) continue
            val compact = line
                .replace(Regex("(?<=[\\u4e00-\\u9fff])\\s+(?=[\\u4e00-\\u9fff])"), "")
                .replace(Regex("^[＊*]\\s*"), "")

            // 只有座號的列：等下一列的名稱。
            val seatOnly = Regex("^(\\d{1,2})$").find(compact)
            if (seatOnly != null) {
                val number = seatOnly.groupValues[1].toIntOrNull()
                pendingSeat = if (number != null && number in 1..99) {
                    number.toString().padStart(2, '0')
                } else {
                    null
                }
                continue
            }

            if (pendingSeat != null) {
                val nameOnly = Regex("^([\\u4e00-\\u9fff]{1,10})$").find(compact)
                if (nameOnly != null) {
                    bySeat[pendingSeat!!] = nameOnly.groupValues[1]
                    pendingSeat = null
                    continue
                }
                pendingSeat = null
            }

            val anchored = inline.find(compact)
            if (anchored != null) {
                val seat = anchored.groupValues[1].padStart(2, '0')
                val number = seat.toIntOrNull() ?: continue
                if (number in 1..99) bySeat[seat] = anchored.groupValues[2]
                continue
            }

            val found = loose.find(compact) ?: continue
            val seat = found.groupValues[1].padStart(2, '0')
            val number = seat.toIntOrNull() ?: continue
            val name = found.groupValues[2]
            if (number !in 1..99) continue
            if (name.contains("學年度") || name.contains("成績") || name.contains("座號")) continue
            bySeat[seat] = name
        }
        return bySeat.entries.sortedBy { it.key }.map { it.key to it.value }
    }

    private fun showRosterEditor(
        students: List<Pair<String, String>>,
        classInfo: ClassInfo,
        rawText: String
    ) {
        val initial = if (students.isEmpty()) {
            rawText
        } else {
            students.joinToString("\n") { "${it.first} ${it.second}" }
        }
        val edit = EditText(this).apply {
            setText(initial)
            hint = getString(R.string.roster_dialog_hint)
            minLines = 12
            gravity = android.view.Gravity.TOP or android.view.Gravity.START
            setPadding(36, 24, 36, 24)
        }
        val scroll = ScrollView(this).apply { addView(edit) }

        val dialog = AlertDialog.Builder(this)
            .setTitle(R.string.roster_dialog_title)
            .setView(scroll)
            .setPositiveButton(R.string.roster_upload, null)
            .setNegativeButton(android.R.string.cancel, null)
            .create()

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.setOnClickListener {
                val parsed = parseRosterLines(edit.text.toString())
                if (parsed.isEmpty()) {
                    showMessage(getString(R.string.roster_empty))
                    return@setOnClickListener
                }
                dialog.dismiss()
                uploadRoster(parsed, classInfo)
            }
        }
        dialog.show()
    }

    private fun uploadRoster(students: List<Pair<String, String>>, classInfo: ClassInfo) {
        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { writeRosterToDrive(classInfo, students) }
            }
            result.fold(
                onSuccess = {
                    showMessage(getString(R.string.roster_uploaded, students.size))
                },
                onFailure = {
                    showMessage(getString(R.string.msg_upload_failed, it.message ?: ""))
                }
            )
        }
    }

    private fun writeRosterToDrive(
        classInfo: ClassInfo,
        students: List<Pair<String, String>>
    ) {
        val uriStr = prefs.getString(KEY_DRIVE_URI, null)
            ?: throw IOException("尚未設定 Drive 資料夾")
        val root = DocumentFile.fromTreeUri(this, Uri.parse(uriStr))
            ?: throw IOException("無法存取 Drive 資料夾")
        val dir = root.findFile(ROSTER_DIR) ?: root.createDirectory(ROSTER_DIR)
            ?: throw IOException("無法建立 $ROSTER_DIR 資料夾")
        val name = "${classInfo.id}-${Filenames.sessionId()}.json"
        val file = dir.findFile(name) ?: dir.createFile("application/json", name)
            ?: throw IOException("無法建立名單檔")

        val studentsJson = JSONArray()
        for ((seat, studentName) in students) {
            studentsJson.put(JSONObject().apply {
                put("seat", seat)
                put("name", studentName)
            })
        }
        val json = JSONObject().apply {
            put("schema_version", 1)
            put("class_id", classInfo.id)
            put("class_name", classInfo.name)
            put("generated_at", Filenames.capturedAt())
            put("students", studentsJson)
        }
        contentResolver.openOutputStream(file.uri, "w")?.use {
            it.write(json.toString().toByteArray(Charsets.UTF_8))
        } ?: throw IOException("無法寫入名單檔")
    }

    /**
     * 掃描完成後先確認方向：預覽第一頁縮圖，選擇的角度會套用到整批頁面。
     * 取消時不寫 pending、不上傳。
     */
    private fun showRotationDialog(
        pages: List<GmsDocumentScanningResult.Page>,
        classId: String,
        assignmentId: String,
        seat: String
    ) {
        val content = LayoutInflater.from(this).inflate(R.layout.dialog_scan_rotation, null)
        val previewImage = content.findViewById<ImageView>(R.id.rotationPreviewImage)
        val previewHint = content.findViewById<TextView>(R.id.rotationPreviewHint)
        val rotationGroup = content.findViewById<RadioGroup>(R.id.rotationGroup)

        val thumbs = listOf(
            content.findViewById<ImageView>(R.id.rotationThumb0) to 0,
            content.findViewById<ImageView>(R.id.rotationThumb90) to 90,
            content.findViewById<ImageView>(R.id.rotationThumb180) to 180,
            content.findViewById<ImageView>(R.id.rotationThumb270) to 270
        )
        val thumbBitmaps = mutableListOf<Bitmap>()

        var previewBitmap: Bitmap? = null
        val dialog = AlertDialog.Builder(this)
            .setView(content)
            .setPositiveButton(R.string.scan_rotation_upload, null)
            .setNegativeButton(R.string.scan_rotation_cancel, null)
            .create()

        rotationGroup.setOnCheckedChangeListener { _, _ ->
            previewImage.rotation = selectedRotation(rotationGroup).toFloat()
            updateThumbSelection(thumbs, selectedRotation(rotationGroup))
        }

        dialog.setOnDismissListener {
            rotationGroup.setOnCheckedChangeListener(null)
            previewImage.setImageDrawable(null)
            previewBitmap?.takeIf { !it.isRecycled }?.recycle()
            previewBitmap = null
            thumbBitmaps.forEach { if (!it.isRecycled) it.recycle() }
            thumbBitmaps.clear()
        }
        dialog.setCanceledOnTouchOutside(false)
        dialog.show()

        thumbs.forEach { (view, angle) ->
            view.setOnClickListener {
                rotationGroup.check(
                    when (angle) {
                        90 -> R.id.rotation90
                        180 -> R.id.rotation180
                        270 -> R.id.rotation270
                        else -> R.id.rotation0
                    }
                )
            }
        }

        // 覆寫「上傳」按鈕，先取角度再關閉，避免預設監聽直接 dismiss。
        dialog.getButton(AlertDialog.BUTTON_POSITIVE)?.setOnClickListener {
            val rotation = selectedRotation(rotationGroup)
            dialog.dismiss()
            saveAndUpload(pages, classId, assignmentId, seat, rotation)
        }

        lifecycleScope.launch {
            val bitmap = withContext(Dispatchers.IO) {
                runCatching { decodePreviewBitmap(pages.first().imageUri, PREVIEW_MAX_LONG_SIDE) }
                    .getOrNull()
            }
            if (!dialog.isShowing) {
                bitmap?.takeIf { !it.isRecycled }?.recycle()
                return@launch
            }
            if (bitmap == null) {
                previewHint.text = getString(R.string.scan_rotation_preview_failed)
                return@launch
            }
            previewBitmap = bitmap
            previewImage.setImageBitmap(bitmap)
            previewImage.rotation = selectedRotation(rotationGroup).toFloat()
            previewHint.visibility = View.GONE
            buildOrientationThumbs(bitmap, thumbs, thumbBitmaps)
            updateThumbSelection(thumbs, selectedRotation(rotationGroup))
        }
    }

    /** 名條 OCR 用：盡量保留原始解析度，小字才辨識得到。 */
    private fun decodeForOcr(uri: Uri): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val options = BitmapFactory.Options().apply {
            inSampleSize = ImageRotation.sampleSizeFor(bounds.outWidth, bounds.outHeight, OCR_MAX_LONG_SIDE)
        }
        val decoded = contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, options)
        } ?: return null
        val orientation = readExifOrientation(uri)
        val upright = applyExifOrientation(decoded, orientation)
        Log.i(
            UPLOAD_LOG_TAG,
            "roster bitmap ${upright.width}x${upright.height} exif=$orientation src=${bounds.outWidth}x${bounds.outHeight}"
        )
        return upright
    }

    /** 建立 0／90／180／270 四張縮圖，讓老師直接用眼睛挑正立的那張。 */
    private fun buildOrientationThumbs(
        source: Bitmap,
        thumbs: List<Pair<ImageView, Int>>,
        stash: MutableList<Bitmap>
    ) {
        val longSide = THUMB_MAX_LONG_SIDE
        val scale = longSide.toFloat() / maxOf(source.width, source.height)
        val width = maxOf(1, (source.width * scale).roundToInt())
        val height = maxOf(1, (source.height * scale).roundToInt())
        val base = Bitmap.createScaledBitmap(source, width, height, true)

        for ((view, angle) in thumbs) {
            val thumb = if (angle == 0) {
                base
            } else {
                Bitmap.createBitmap(
                    base,
                    0,
                    0,
                    base.width,
                    base.height,
                    Matrix().apply { postRotate(angle.toFloat()) },
                    true
                )
            }
            view.setImageBitmap(thumb)
            stash.add(thumb)
        }
        // base 一定是 0° 的縮圖，已加入 stash，不能在這裡回收。
    }

    private fun updateThumbSelection(thumbs: List<Pair<ImageView, Int>>, selected: Int) {
        for ((view, angle) in thumbs) {
            view.alpha = if (angle == selected) 1f else 0.45f
        }
    }

    /** 內建使用說明：可捲動、可選取文字，內容與桌機版一致的精簡版。 */
    private fun showHelpDialog() {
        val density = resources.displayMetrics.density
        val body = TextView(this).apply {
            text = getString(R.string.help_text)
            textSize = 15f
            setLineSpacing(0f, 1.3f)
            setPadding(
                (20 * density).toInt(),
                (12 * density).toInt(),
                (20 * density).toInt(),
                (12 * density).toInt()
            )
            setTextIsSelectable(true)
        }
        val scroll = ScrollView(this).apply { addView(body) }
        AlertDialog.Builder(this)
            .setTitle(R.string.help_title)
            .setView(scroll)
            .setPositiveButton(android.R.string.ok, null)
            .show()
    }

    private fun selectedRotation(group: RadioGroup): Int = when (group.checkedRadioButtonId) {        R.id.rotation90 -> 90
        R.id.rotation180 -> 180
        R.id.rotation270 -> 270
        else -> 0
    }

    /** 背景解碼第一頁縮圖；長邊限制在 maxLongSide 內，避免 OOM。 */
    private fun decodePreviewBitmap(uri: Uri, maxLongSide: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        val options = BitmapFactory.Options().apply {
            inSampleSize = ImageRotation.sampleSizeFor(bounds.outWidth, bounds.outHeight, maxLongSide)
        }
        val decoded = contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, options)
        } ?: return null
        val orientation = readExifOrientation(uri)
        val upright = applyExifOrientation(decoded, orientation)
        Log.i(
            UPLOAD_LOG_TAG,
            "preview exif=$orientation upright=${upright.width}x${upright.height}"
        )
        return upright
    }

    /** BitmapFactory 不會套用 EXIF Orientation，必須自己轉正。 */
    private fun readExifOrientation(uri: Uri): Int = runCatching {
        contentResolver.openInputStream(uri)?.use {
            ExifInterface(it).getAttributeInt(
                ExifInterface.TAG_ORIENTATION,
                ExifInterface.ORIENTATION_NORMAL
            )
        } ?: ExifInterface.ORIENTATION_NORMAL
    }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)

    private fun applyExifOrientation(bitmap: Bitmap, orientation: Int): Bitmap {
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.setRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.setRotate(-90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
            else -> return bitmap
        }

        val upright = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
        if (upright !== bitmap) bitmap.recycle()
        return upright
    }

    private fun saveAndUpload(
        pages: List<GmsDocumentScanningResult.Page>,
        classId: String,
        assignmentId: String,
        seat: String,
        rotationDegrees: Int
    ) {
        Log.i(
            UPLOAD_LOG_TAG,
            "save class=$classId assignment=$assignmentId seat=$seat pages=${pages.size} rotation=$rotationDegrees"
        )
        val sessionId = Filenames.sessionId()
        val capturedAt = Filenames.capturedAt()

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                savePending(
                    classId,
                    assignmentId,
                    seat,
                    sessionId,
                    capturedAt,
                    pages,
                    rotationDegrees
                )
            }
            if (!result.success) {
                showMessage(
                    getString(result.errorRes ?: R.string.msg_scan_save_failed)
                )
                updatePendingStatus()
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
        pages: List<GmsDocumentScanningResult.Page>,
        rotationDegrees: Int
    ): PendingSaveResult {
        val rotation = ImageRotation.normalizeDegrees(rotationDegrees)
        val dir = File(filesDir, "pending/$sessionId")
        val createdFiles = mutableListOf<File>()

        fun discardCreatedFiles() {
            createdFiles.forEach { runCatching { it.delete() } }
            if (dir.isDirectory && dir.listFiles()?.isEmpty() != false) {
                runCatching { dir.delete() }
            }
        }

        return try {
            if (!dir.exists() && !dir.mkdirs()) return PendingSaveResult(false)
            for (i in pages.indices) {
                val seq = i + 1
                val target = File(dir, Filenames.pendingPageFileName(seq))
                val temp = File(dir, "${target.name}.tmp")
                createdFiles += temp

                // 一律依 EXIF 轉正後再套用使用者角度，確保預覽與桌機看到的一致。
                rotatePageToFile(pages[i].imageUri, temp, rotation)

                if (!temp.renameTo(target)) {
                    // 少數檔案系統不支援直接 rename，退回複製後刪除暫存檔。
                    FileInputStream(temp).use { ins ->
                        FileOutputStream(target).use { outs -> copyStream(ins, outs) }
                    }
                    temp.delete()
                }
                createdFiles += target
            }
            val metaFile = File(dir, "meta.json")
            createdFiles += metaFile
            val meta = PendingMeta(classId, assignmentId, seat, sessionId, capturedAt, pages.size)
            metaFile.writeText(meta.toJson(), Charsets.UTF_8)
            PendingSaveResult(true)
        } catch (_: OutOfMemoryError) {
            discardCreatedFiles()
            PendingSaveResult(false, R.string.msg_scan_rotate_failed)
        } catch (_: PageRotationException) {
            discardCreatedFiles()
            PendingSaveResult(false, R.string.msg_scan_rotate_failed)
        } catch (_: Exception) {
            discardCreatedFiles()
            PendingSaveResult(
                false,
                if (rotation == 0) null else R.string.msg_scan_rotate_failed
            )
        }
    }

    /** 解碼單頁、依 EXIF 轉正、套用角度後以 JPEG 寫入；只保留必要 Bitmap。 */
    private fun rotatePageToFile(uri: Uri, outputFile: File, degrees: Int) {
        val original = contentResolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it)
        } ?: throw PageRotationException("無法解碼頁面")

        val exifOrientation = readExifOrientation(uri)
        val upright = applyExifOrientation(original, exifOrientation)
        Log.i(
            UPLOAD_LOG_TAG,
            "page exif=$exifOrientation src=${original.width}x${original.height} upright=${upright.width}x${upright.height} degrees=$degrees"
        )
        val result = if (degrees == 0) {
            upright
        } else {
            val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
            Bitmap.createBitmap(upright, 0, 0, upright.width, upright.height, matrix, true)
        }

        try {
            FileOutputStream(outputFile).use { outs ->
                if (!result.compress(Bitmap.CompressFormat.JPEG, PAGE_JPEG_QUALITY, outs)) {
                    throw PageRotationException("無法壓縮頁面")
                }
            }
        } finally {
            if (result !== upright && !result.isRecycled) result.recycle()
            if (!upright.isRecycled) upright.recycle()
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
        Log.i(
            UPLOAD_LOG_TAG,
            "root=${treeUri} class=${classDir.uri} assignment=${assignmentDir.uri} pages=${meta.pageCount}"
        )

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
        val writtenBytes = imageDoc.length()
        Log.i(
            UPLOAD_LOG_TAG,
            "image=${imageDoc.uri} name=$pageFileName bytes=$writtenBytes pending=${pendingFile.length()}"
        )
        if (writtenBytes <= 0L) throw IOException("寫入 0 bytes：$pageFileName")

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
        Log.i(
            UPLOAD_LOG_TAG,
            "sidecar=${sidecarDoc.uri} name=$sidecarName bytes=${sidecarDoc.length()}"
        )
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

    private data class PendingSaveResult(
        val success: Boolean,
        val errorRes: Int? = null
    )

    companion object {
        private const val PREFS_NAME = "scanner_prefs"
        private const val KEY_DRIVE_URI = "drive_tree_uri"
        private const val KEY_MANIFEST_URI = "manifest_uri"
        private const val KEY_MANIFEST_NAME = "manifest_name"
        private const val MANIFEST_FILE_NAME = "manifest.json"
        private const val PREVIEW_MAX_LONG_SIDE = 1200
        private const val PAGE_JPEG_QUALITY = 92
        private const val UPLOAD_LOG_TAG = "EssayGraderUpload"
        private const val THUMB_MAX_LONG_SIDE = 200
        private const val OCR_MAX_LONG_SIDE = 3000
        private const val ROSTER_DIR = "_roster"
    }
}

/** 單頁旋轉或重新編碼失敗，用於區分一般存檔錯誤。 */
private class PageRotationException(message: String) : IOException(message)

private fun copyStream(input: InputStream, output: OutputStream) {
    val buffer = ByteArray(8192)
    while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        output.write(buffer, 0, read)
    }
    output.flush()
}

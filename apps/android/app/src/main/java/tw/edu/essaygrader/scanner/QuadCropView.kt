package tw.edu.essaygrader.scanner

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import kotlin.math.hypot

/**
 * 四角選取檢視：使用者依序點左上、右上、右下、左下，
 * 座標以 0–1 正規化保存，方便套用到原始高解析 Bitmap。
 */
class QuadCropView(context: Context) : View(context) {

    var bitmap: Bitmap? = null
        set(value) {
            field = value
            invalidate()
        }

    val points = mutableListOf<PointF>()
    var onChange: (() -> Unit)? = null

    private var activeIndex = -1
    private val pointPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#2B6CB0")
        style = Paint.Style.FILL
    }
    private val ringPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 3f
    }
    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#2B6CB0")
        style = Paint.Style.STROKE
        strokeWidth = 4f
    }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#332B6CB0")
        style = Paint.Style.FILL
    }
    private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG)

    private val imageRect = RectF()

    private fun updateImageRect() {
        val source = bitmap ?: return
        val scale = minOf(width.toFloat() / source.width, height.toFloat() / source.height)
        val drawWidth = source.width * scale
        val drawHeight = source.height * scale
        val left = (width - drawWidth) / 2f
        val top = (height - drawHeight) / 2f
        imageRect.set(left, top, left + drawWidth, top + drawHeight)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val source = bitmap ?: return
        updateImageRect()
        canvas.drawBitmap(source, null, imageRect, bitmapPaint)

        if (points.size >= 2) {
            val path = Path()
            for (index in points.indices) {
                val point = toView(points[index])
                if (index == 0) path.moveTo(point.x, point.y) else path.lineTo(point.x, point.y)
            }
            if (points.size == 4) {
                path.close()
                canvas.drawPath(path, fillPaint)
            }
            canvas.drawPath(path, linePaint)
        }

        for ((index, point) in points.withIndex()) {
            val viewPoint = toView(point)
            canvas.drawCircle(viewPoint.x, viewPoint.y, 16f, pointPaint)
            canvas.drawCircle(viewPoint.x, viewPoint.y, 16f, ringPaint)
            val label = (index + 1).toString()
            val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                textSize = 26f
                textAlign = Paint.Align.CENTER
            }
            canvas.drawText(label, viewPoint.x, viewPoint.y + 9f, textPaint)
        }
    }

    private fun toView(point: PointF): PointF =
        PointF(imageRect.left + point.x * imageRect.width(), imageRect.top + point.y * imageRect.height())

    private fun toNormalized(x: Float, y: Float): PointF {
        val nx = ((x - imageRect.left) / imageRect.width()).coerceIn(0f, 1f)
        val ny = ((y - imageRect.top) / imageRect.height()).coerceIn(0f, 1f)
        return PointF(nx, ny)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (bitmap == null) return false
        updateImageRect()
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                if (!imageRect.contains(event.x, event.y)) return false
                activeIndex = nearestPoint(event.x, event.y)
                if (activeIndex < 0 && points.size < 4) {
                    points.add(toNormalized(event.x, event.y))
                    activeIndex = points.lastIndex
                    onChange?.invoke()
                    invalidate()
                }
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (activeIndex in points.indices) {
                    points[activeIndex] = toNormalized(event.x, event.y)
                    invalidate()
                }
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                activeIndex = -1
                return true
            }
        }
        return false
    }

    private fun nearestPoint(x: Float, y: Float): Int {
        var best = -1
        var bestDistance = 50f
        for ((index, point) in points.withIndex()) {
            val viewPoint = toView(point)
            val distance = hypot(viewPoint.x - x, viewPoint.y - y)
            if (distance < bestDistance) {
                bestDistance = distance
                best = index
            }
        }
        return best
    }

    fun reset() {
        points.clear()
        onChange?.invoke()
        invalidate()
    }
}

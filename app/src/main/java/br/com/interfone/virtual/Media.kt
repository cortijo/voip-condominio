package br.com.interfone.virtual

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import java.io.ByteArrayOutputStream
import java.io.File

/** Preparação de fotos para o chat: reduz para no máximo 1280 px, corrige a rotação e comprime em JPEG. */
object MediaUtil {
    private const val MAX_SIDE = 1280

    fun imageToJpeg(ctx: Context, uri: Uri): ByteArray {
        val cr = ctx.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalArgumentException("Imagem inválida")
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        var bmp = cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
            ?: throw IllegalArgumentException("Imagem inválida")

        val rotation = try {
            cr.openInputStream(uri)?.use {
                when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> 0f
                }
            } ?: 0f
        } catch (e: Exception) { 0f }

        val k = minOf(1f, MAX_SIDE.toFloat() / maxOf(bmp.width, bmp.height))
        if (rotation != 0f || k < 1f) {
            val m = Matrix().apply { postRotate(rotation); postScale(k, k) }
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 80, out)
        return out.toByteArray()
    }
}

/** Gravador de áudio do chat (AAC em .m4a, mono, baixa taxa — ~240 KB por minuto). */
object AudioRecorder {
    const val MAX_SECONDS = 120

    private var rec: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L

    val isRecording: Boolean get() = rec != null

    fun start(ctx: Context, onLimit: () -> Unit): Boolean {
        if (rec != null) return true
        val f = File(ctx.cacheDir, "rec_${System.currentTimeMillis()}.m4a")
        return try {
            @Suppress("DEPRECATION")
            val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else MediaRecorder()
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1)
            r.setAudioSamplingRate(22050)
            r.setAudioEncodingBitRate(32000)
            r.setMaxDuration(MAX_SECONDS * 1000)
            r.setOnInfoListener { _, what, _ ->
                if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) onLimit()
            }
            r.setOutputFile(f.absolutePath)
            r.prepare()
            r.start()
            rec = r; file = f; startedAt = System.currentTimeMillis()
            true
        } catch (e: Exception) {
            rec = null; file = null; f.delete()
            false
        }
    }

    /** Encerra e devolve os bytes do áudio (ou null se foi curto demais / falhou). */
    fun stop(): ByteArray? {
        val r = rec ?: return null
        val f = file
        val ms = System.currentTimeMillis() - startedAt
        rec = null; file = null
        val ok = try { r.stop(); true } catch (e: RuntimeException) { false }
        try { r.release() } catch (e: Exception) { /* ignora */ }
        val bytes = if (ok && ms >= 700 && f != null) try { f.readBytes() } catch (e: Exception) { null } else null
        f?.delete()
        return bytes
    }

    fun cancel() { stop() }
}

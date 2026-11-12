package com.resona.core

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.resona.MainActivity
import com.resona.R
import java.io.File
import java.io.RandomAccessFile
import kotlin.math.sqrt

/**
 * Service au premier plan qui enregistre le micro en WAV 16 kHz mono.
 * Il continue de tourner écran éteint ou application en arrière-plan.
 */
class RecordingService : Service() {

  companion object {
    const val ACTION_START = "com.resona.REC_START"
    const val ACTION_STOP = "com.resona.REC_STOP"
    const val ACTION_PAUSE = "com.resona.REC_PAUSE"
    const val ACTION_RESUME = "com.resona.REC_RESUME"
    const val EXTRA_ID = "id"
    const val EXTRA_PATH = "path"
    private const val CHANNEL_ID = "resona_recording"
    private const val NOTIF_ID = 4201

    @Volatile var active = false
    @Volatile var paused = false
    @Volatile var recordingId: String? = null
    @Volatile var filePath: String? = null
    @Volatile var samplesWritten = 0L
    @Volatile var level = 0f
    @Volatile var lastError: String? = null

    val elapsedSec: Double get() = samplesWritten.toDouble() / Wav.SAMPLE_RATE

    fun intent(ctx: Context, action: String) = Intent(ctx, RecordingService::class.java).setAction(action)
  }

  private var thread: Thread? = null
  @Volatile private var running = false
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        val id = intent.getStringExtra(EXTRA_ID) ?: return START_NOT_STICKY
        val path = intent.getStringExtra(EXTRA_PATH) ?: return START_NOT_STICKY
        start(id, path)
      }
      ACTION_PAUSE -> { paused = true; updateNotification() }
      ACTION_RESUME -> { paused = false; updateNotification() }
      ACTION_STOP -> stopRecording()
    }
    return START_NOT_STICKY
  }

  private fun start(id: String, path: String) {
    if (active) return
    createChannel()
    val notif = buildNotification()
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
    ServiceCompat.startForeground(this, NOTIF_ID, notif, type)

    recordingId = id
    filePath = path
    samplesWritten = 0
    paused = false
    lastError = null
    active = true
    running = true

    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "resona:recording").apply {
      setReferenceCounted(false)
      acquire(12 * 60 * 60 * 1000L)
    }

    thread = Thread({ recordLoop(File(path)) }, "resona-recorder").also { it.start() }
  }

  @SuppressLint("MissingPermission")
  private fun recordLoop(file: File) {
    val sr = Wav.SAMPLE_RATE
    val minBuf = AudioRecord.getMinBufferSize(sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val bufSize = maxOf(minBuf, sr / 5 * 2) // ~200 ms
    var recorder: AudioRecord? = null
    var raf: RandomAccessFile? = null
    try {
      file.parentFile?.mkdirs()
      recorder = AudioRecord(MediaRecorder.AudioSource.MIC, sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize * 2)
      if (recorder.state != AudioRecord.STATE_INITIALIZED) throw IllegalStateException("Micro indisponible")
      raf = RandomAccessFile(file, "rw")
      raf.setLength(0)
      Wav.writeHeader(raf, 0)
      raf.seek(44)
      recorder.startRecording()

      val shorts = ShortArray(sr / 10) // 100 ms
      val bytes = ByteArray(shorts.size * 2)
      var sinceHeader = 0L
      while (running) {
        val n = recorder.read(shorts, 0, shorts.size)
        if (n <= 0) continue
        var sum = 0.0
        for (i in 0 until n) {
          val s = shorts[i].toInt()
          sum += (s * s).toDouble()
          bytes[2 * i] = (s and 0xff).toByte()
          bytes[2 * i + 1] = ((s shr 8) and 0xff).toByte()
        }
        level = (sqrt(sum / n) / 32768.0).toFloat()
        if (paused) { level = 0f; continue }
        raf.write(bytes, 0, n * 2)
        samplesWritten += n
        sinceHeader += n
        // Met à jour l'en-tête toutes les ~5 s : le fichier reste lisible même en cas de crash.
        if (sinceHeader >= sr * 5) {
          Wav.writeHeader(raf, samplesWritten * 2)
          sinceHeader = 0
        }
      }
      Wav.writeHeader(raf, samplesWritten * 2)
    } catch (t: Throwable) {
      lastError = t.message ?: t.toString()
    } finally {
      try { recorder?.stop() } catch (_: Throwable) {}
      recorder?.release()
      try { raf?.close() } catch (_: Throwable) {}
    }
  }

  private fun stopRecording() {
    running = false
    thread?.join(3000)
    thread = null
    active = false
    paused = false
    level = 0f
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    if (active) stopRecording()
    super.onDestroy()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Enregistrement", NotificationManager.IMPORTANCE_LOW))
    }
  }

  private fun pending(action: String, code: Int): PendingIntent =
    PendingIntent.getService(this, code, intent(this, action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

  private fun buildNotification(): Notification {
    val open = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val b = NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_mic)
      .setContentTitle(if (paused) "Resona — en pause" else "Resona enregistre la réunion")
      .setContentText("Touchez pour ouvrir")
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(open)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    if (paused) b.addAction(0, "Reprendre", pending(ACTION_RESUME, 2))
    else b.addAction(0, "Pause", pending(ACTION_PAUSE, 1))
    b.addAction(0, "Arrêter", pending(ACTION_STOP, 3))
    return b.build()
  }

  private fun updateNotification() {
    if (!active) return
    getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotification())
  }
}

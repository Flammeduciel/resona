package com.resona.core

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.resona.MainActivity
import com.resona.R
import org.json.JSONObject
import java.io.File

/**
 * Service au premier plan pour l'analyse.
 *
 * Il tourne dans un PROCESSUS SÉPARÉ (":analysis", voir AndroidManifest) : si le code natif plante
 * (manque de mémoire…), seule l'analyse s'arrête, l'application reste ouverte et affiche l'erreur.
 * L'état est donc partagé via un petit fichier JSON plutôt qu'en mémoire.
 */
class ProcessingService : Service() {

  companion object {
    private const val CHANNEL_ID = "resona_processing"
    private const val NOTIF_ID = 4202
    /** Au-delà, un état « running » sans battement de cœur signifie que le processus est mort. */
    private const val STALE_MS = 30_000L

    fun stateFile(ctx: Context) = File(ctx.filesDir, "analysis-state.json")
    fun cancelFile(ctx: Context) = File(ctx.filesDir, "analysis-cancel")

    data class State(
      val running: Boolean,
      val id: String?,
      val stage: String,
      val progress: Double,
      val error: String?,
      val finishedId: String?,
    )

    fun readState(ctx: Context): State {
      val f = stateFile(ctx)
      if (!f.exists()) return State(false, null, "", 0.0, null, null)
      return try {
        val j = JSONObject(f.readText())
        val id = j.optString("id").ifEmpty { null }
        var running = j.optBoolean("running")
        var error = j.optString("error").ifEmpty { null }
        if (running && System.currentTimeMillis() - j.optLong("heartbeat") > STALE_MS) {
          running = false
          error = "L'analyse s'est arrêtée brutalement (mémoire insuffisante ?). Essayez un modèle Whisper plus petit."
        }
        State(running, id, j.optString("stage"), j.optDouble("progress", 0.0), error, j.optString("finishedId").ifEmpty { null })
      } catch (_: Throwable) {
        State(false, null, "", 0.0, null, null)
      }
    }

    fun start(ctx: Context, o: ProcessOptions): Boolean {
      if (readState(ctx).running) return false
      cancelFile(ctx).delete()
      // État initial écrit tout de suite, pour que l'interface voie l'analyse démarrer.
      writeState(ctx, JSONObject().put("running", true).put("id", o.id).put("stage", "Préparation").put("progress", 0.0)
        .put("heartbeat", System.currentTimeMillis()))
      val i = Intent(ctx, ProcessingService::class.java)
        .putExtra("id", o.id).putExtra("wavPath", o.wavPath).putExtra("outPath", o.outPath)
        .putExtra("segmentationModel", o.segmentationModel).putExtra("embeddingModel", o.embeddingModel)
        .putExtra("whisperEncoder", o.whisperEncoder).putExtra("whisperDecoder", o.whisperDecoder)
        .putExtra("whisperTokens", o.whisperTokens).putExtra("language", o.language)
        .putExtra("numSpeakers", o.numSpeakers).putExtra("threshold", o.threshold).putExtra("threads", o.threads)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
      return true
    }

    fun requestCancel(ctx: Context) {
      cancelFile(ctx).writeText("1")
    }

    @Synchronized
    private fun writeState(ctx: Context, j: JSONObject) {
      val f = stateFile(ctx)
      val tmp = File(f.path + ".tmp")
      tmp.writeText(j.toString())
      tmp.renameTo(f)
    }
  }

  @Volatile private var stage = "Préparation"
  @Volatile private var progress = 0.0
  @Volatile private var lastNotifPct = -1
  private var started = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    createChannel()
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
    ServiceCompat.startForeground(this, NOTIF_ID, buildNotification("Préparation", 0), type)

    if (intent == null || started) {
      if (!started) stopSelf()
      return START_NOT_STICKY
    }
    started = true
    val opts = ProcessOptions(
      id = intent.getStringExtra("id")!!,
      wavPath = intent.getStringExtra("wavPath")!!,
      outPath = intent.getStringExtra("outPath")!!,
      segmentationModel = intent.getStringExtra("segmentationModel")!!,
      embeddingModel = intent.getStringExtra("embeddingModel")!!,
      whisperEncoder = intent.getStringExtra("whisperEncoder"),
      whisperDecoder = intent.getStringExtra("whisperDecoder"),
      whisperTokens = intent.getStringExtra("whisperTokens"),
      language = intent.getStringExtra("language") ?: "",
      numSpeakers = intent.getIntExtra("numSpeakers", 0),
      threshold = intent.getFloatExtra("threshold", 0.6f),
      threads = intent.getIntExtra("threads", 2),
    )

    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "resona:processing").apply {
      setReferenceCounted(false)
      acquire(6 * 60 * 60 * 1000L)
    }

    fun publish(running: Boolean, error: String? = null, finished: Boolean = false) {
      writeState(this, JSONObject()
        .put("running", running).put("id", opts.id).put("stage", stage).put("progress", progress)
        .put("error", error ?: "").put("finishedId", if (finished) opts.id else "")
        .put("heartbeat", System.currentTimeMillis()))
    }

    // Battement de cœur : prouve à l'interface que le processus d'analyse est toujours vivant.
    val heartbeat = Thread {
      try {
        while (true) { publish(true); Thread.sleep(1000) }
      } catch (_: InterruptedException) {}
    }.apply { isDaemon = true; start() }

    Thread({
      var error: String? = null
      try {
        Processor(opts, { s, p ->
          stage = s
          progress = p
          val pct = (p * 100).toInt()
          if (pct != lastNotifPct) {
            lastNotifPct = pct
            getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotification(s, pct))
          }
        }, { cancelFile(this).exists() }).run()
      } catch (t: Throwable) {
        error = if (t is CancelledException) "Annulé" else (t.message ?: t.toString())
        if (t is OutOfMemoryError) error = "Mémoire insuffisante pour cette réunion. Essayez un modèle Whisper plus petit."
      } finally {
        heartbeat.interrupt()
        try { heartbeat.join(2000) } catch (_: Throwable) {}
        publish(false, error, finished = error == null)
        cancelFile(this).delete()
        if (wl.isHeld) wl.release()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
        // libère toute la mémoire native (modèles) en terminant le processus d'analyse
        android.os.Process.killProcess(android.os.Process.myPid())
      }
    }, "resona-processor").start()
    return START_NOT_STICKY
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getSystemService(NotificationManager::class.java)
        .createNotificationChannel(NotificationChannel(CHANNEL_ID, "Analyse", NotificationManager.IMPORTANCE_LOW))
    }
  }

  private fun buildNotification(stage: String, pct: Int): Notification {
    val open = PendingIntent.getActivity(
      this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_stat_mic)
      .setContentTitle("Resona analyse la réunion")
      .setContentText("$stage — $pct %")
      .setProgress(100, pct, false)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(open)
      .build()
  }
}

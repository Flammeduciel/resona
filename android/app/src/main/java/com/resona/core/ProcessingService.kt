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

/**
 * Service au premier plan pour l'analyse : une réunion d'une heure peut prendre plusieurs minutes,
 * l'analyse doit continuer même si l'utilisateur quitte l'application.
 */
class ProcessingService : Service() {

  companion object {
    private const val CHANNEL_ID = "resona_processing"
    private const val NOTIF_ID = 4202

    @Volatile var pending: ProcessOptions? = null
    @Volatile var running = false
    @Volatile var currentId: String? = null
    @Volatile var stage = ""
    @Volatile var progress = 0.0
    @Volatile var error: String? = null
    @Volatile var finishedId: String? = null
    @Volatile var cancelRequested = false

    fun start(ctx: Context, opts: ProcessOptions): Boolean {
      if (running) return false
      pending = opts
      running = true
      currentId = opts.id
      stage = "Préparation"
      progress = 0.0
      error = null
      finishedId = null
      cancelRequested = false
      val i = Intent(ctx, ProcessingService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
      return true
    }
  }

  private var lastNotifPct = -1

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val opts = pending
    if (opts == null) { stopSelf(); return START_NOT_STICKY }
    pending = null
    createChannel()
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
    ServiceCompat.startForeground(this, NOTIF_ID, buildNotification("Préparation", 0), type)

    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    val wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "resona:processing").apply {
      setReferenceCounted(false)
      acquire(6 * 60 * 60 * 1000L)
    }

    Thread({
      try {
        Processor(opts, { s, p ->
          stage = s
          progress = p
          val pct = (p * 100).toInt()
          if (pct != lastNotifPct) {
            lastNotifPct = pct
            getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotification(s, pct))
          }
        }, { cancelRequested }).run()
        finishedId = opts.id
      } catch (t: Throwable) {
        error = if (t is CancelledException) "Annulé" else (t.message ?: t.toString())
      } finally {
        running = false
        if (wl.isHeld) wl.release()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
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

package com.resona.core

import android.content.ContentValues
import android.content.Intent
import android.os.Environment
import android.os.Handler
import android.provider.MediaStore
import android.view.HapticFeedbackConstants
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ReadableArray
import android.media.MediaPlayer
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import java.io.File

/** Pont entre l'interface React Native et le code natif (enregistrement, modèles, analyse, lecture). */
class ResonaModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName() = "Resona"

  private val base: File get() = ctx.filesDir

  // ---------- Fichiers ----------

  @ReactMethod
  fun getPaths(promise: Promise) {
    val m = Arguments.createMap()
    m.putString("base", base.absolutePath)
    m.putString("recordings", File(base, "recordings").apply { mkdirs() }.absolutePath)
    m.putString("models", File(base, "models").apply { mkdirs() }.absolutePath)
    m.putString("exports", File(ctx.cacheDir, "exports").apply { mkdirs() }.absolutePath)
    m.putInt("sdk", Build.VERSION.SDK_INT)
    m.putInt("cpuCount", Runtime.getRuntime().availableProcessors())
    promise.resolve(m)
  }

  @ReactMethod
  fun readText(path: String, promise: Promise) {
    try {
      val f = File(path)
      promise.resolve(if (f.exists()) f.readText() else null)
    } catch (t: Throwable) { promise.reject("E_READ", t) }
  }

  @ReactMethod
  fun writeText(path: String, content: String, promise: Promise) {
    try {
      val f = File(path)
      f.parentFile?.mkdirs()
      val tmp = File("$path.tmp")
      tmp.writeText(content)
      if (!tmp.renameTo(f)) { f.writeText(content); tmp.delete() }
      promise.resolve(true)
    } catch (t: Throwable) { promise.reject("E_WRITE", t) }
  }

  @ReactMethod
  fun exists(path: String, promise: Promise) = promise.resolve(File(path).exists())

  @ReactMethod
  fun fileSize(path: String, promise: Promise) = promise.resolve(File(path).let { if (it.exists()) it.length().toDouble() else -1.0 })

  @ReactMethod
  fun deletePath(path: String, promise: Promise) = promise.resolve(File(path).deleteRecursively())

  @ReactMethod
  fun listDirs(path: String, promise: Promise) {
    val arr = Arguments.createArray()
    File(path).listFiles()?.filter { it.isDirectory }?.forEach { arr.pushString(it.name) }
    promise.resolve(arr)
  }

  @ReactMethod
  fun wavDuration(path: String, promise: Promise) {
    try {
      val f = File(path)
      promise.resolve(if (f.exists()) Wav.info(f).durationSec else 0.0)
    } catch (t: Throwable) { promise.resolve(0.0) }
  }

  @ReactMethod
  fun repairWav(path: String, promise: Promise) {
    try { Wav.repair(File(path)); promise.resolve(true) } catch (t: Throwable) { promise.reject("E_WAV", t) }
  }

  // ---------- Enregistrement ----------

  @ReactMethod
  fun startRecording(id: String, path: String, promise: Promise) {
    if (RecordingService.active) { promise.reject("E_BUSY", "Un enregistrement est déjà en cours"); return }
    val i = RecordingService.intent(ctx, RecordingService.ACTION_START)
      .putExtra(RecordingService.EXTRA_ID, id)
      .putExtra(RecordingService.EXTRA_PATH, path)
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
      promise.resolve(true)
    } catch (t: Throwable) { promise.reject("E_START", t) }
  }

  private fun send(action: String) {
    ctx.startService(RecordingService.intent(ctx, action))
  }

  @ReactMethod
  fun pauseRecording(promise: Promise) { send(RecordingService.ACTION_PAUSE); promise.resolve(true) }

  @ReactMethod
  fun resumeRecording(promise: Promise) { send(RecordingService.ACTION_RESUME); promise.resolve(true) }

  @ReactMethod
  fun stopRecording(promise: Promise) {
    if (!RecordingService.active) { promise.resolve(RecordingService.elapsedSec); return }
    send(RecordingService.ACTION_STOP)
    Thread {
      var waited = 0
      while (RecordingService.active && waited < 5000) { Thread.sleep(50); waited += 50 }
      promise.resolve(RecordingService.elapsedSec)
    }.start()
  }

  @ReactMethod
  fun getRecorderState(promise: Promise) {
    val m = Arguments.createMap()
    m.putBoolean("active", RecordingService.active)
    m.putBoolean("paused", RecordingService.paused)
    m.putString("id", RecordingService.recordingId)
    m.putDouble("elapsedSec", RecordingService.elapsedSec)
    m.putDouble("level", RecordingService.level.toDouble())
    m.putString("error", RecordingService.lastError)
    promise.resolve(m)
  }

  // ---------- Modèles ----------

  @ReactMethod
  fun download(key: String, url: String, dest: String, promise: Promise) {
    Downloader.start(key, url, dest)
    promise.resolve(true)
  }

  @ReactMethod
  fun getDownloadState(key: String, promise: Promise) {
    val s = Downloader.states[key]
    if (s == null) { promise.resolve(null); return }
    val m = Arguments.createMap()
    m.putDouble("bytes", s.bytes.toDouble())
    m.putDouble("total", s.total.toDouble())
    m.putBoolean("done", s.done)
    m.putString("error", s.error)
    promise.resolve(m)
  }

  // ---------- Analyse locale ----------

  @ReactMethod
  fun startProcessing(o: ReadableMap, promise: Promise) {
    fun str(k: String) = if (o.hasKey(k) && !o.isNull(k)) o.getString(k) else null
    try {
      val opts = ProcessOptions(
        id = str("id")!!,
        wavPath = str("wavPath")!!,
        outPath = str("outPath")!!,
        segmentationModel = str("segmentationModel")!!,
        embeddingModel = str("embeddingModel")!!,
        whisperEncoder = str("whisperEncoder"),
        whisperDecoder = str("whisperDecoder"),
        whisperTokens = str("whisperTokens"),
        language = str("language") ?: "",
        numSpeakers = if (o.hasKey("numSpeakers")) o.getInt("numSpeakers") else 0,
        threshold = if (o.hasKey("threshold")) o.getDouble("threshold").toFloat() else 0.5f,
        threads = if (o.hasKey("threads")) o.getInt("threads") else 2,
      )
      if (!ProcessingService.start(ctx, opts)) { promise.reject("E_BUSY", "Une analyse est déjà en cours"); return }
      promise.resolve(true)
    } catch (t: Throwable) { promise.reject("E_PROCESS", t) }
  }

  @ReactMethod
  fun getProcessingState(promise: Promise) {
    val st = ProcessingService.readState(ctx)
    val m = Arguments.createMap()
    m.putBoolean("running", st.running)
    m.putString("id", st.id)
    m.putString("stage", st.stage)
    m.putDouble("progress", st.progress)
    m.putString("error", st.error)
    m.putString("finishedId", st.finishedId)
    promise.resolve(m)
  }

  @ReactMethod
  fun cancelProcessing(promise: Promise) { ProcessingService.requestCancel(ctx); promise.resolve(true) }

  // ---------- Lecture audio ----------

  private var player: MediaPlayer? = null
  private var playerPath: String? = null
  private var speed = 1f
  // Le lecteur vit sur son propre fil : jamais de travail audio sur le fil principal (risque d'ANR).
  private val playerThread = android.os.HandlerThread("resona-player").apply { start() }
  private val main = Handler(playerThread.looper)
  /** Lecture « par personne » : on enchaîne uniquement ces passages. */
  private var ranges: List<Pair<Double, Double>> = emptyList()
  private var rangeIndex = -1

  private val rangeWatcher = object : Runnable {
    override fun run() {
      val p = player ?: return
      if (rangeIndex < 0 || rangeIndex >= ranges.size) return
      if (p.isPlaying) {
        val pos = p.currentPosition / 1000.0
        val (_, end) = ranges[rangeIndex]
        if (pos >= end) {
          rangeIndex++
          if (rangeIndex >= ranges.size) {
            p.pause()
            rangeIndex = -1
            ranges = emptyList()
            return
          }
          seekMs((ranges[rangeIndex].first * 1000).toLong())
        }
      }
      main.postDelayed(this, 40)
    }
  }

  private fun seekMs(ms: Long) {
    val p = player ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) p.seekTo(ms, MediaPlayer.SEEK_CLOSEST) else p.seekTo(ms.toInt())
  }

  private fun applySpeed(p: MediaPlayer) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      try { p.playbackParams = p.playbackParams.setSpeed(speed) } catch (_: Throwable) {}
    }
  }

  private fun clearRanges() {
    ranges = emptyList()
    rangeIndex = -1
    main.removeCallbacks(rangeWatcher)
  }

  @ReactMethod
  fun playerLoad(path: String, promise: Promise) {
    main.post {
      try {
        if (playerPath == path && player != null) { promise.resolve(player!!.duration / 1000.0); return@post }
        clearRanges()
        player?.release()
        val p = MediaPlayer()
        p.setDataSource(path)
        p.prepare()
        player = p
        playerPath = path
        promise.resolve(p.duration / 1000.0)
      } catch (t: Throwable) { promise.reject("E_PLAYER", t) }
    }
  }

  @ReactMethod
  fun playerPlay(promise: Promise) {
    main.post {
      player?.let { p ->
        // Certaines versions d'Android relancent la lecture lors d'un setSpeed : on l'applique au démarrage.
        p.start()
        applySpeed(p)
      }
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun playerPause(promise: Promise) {
    main.post { player?.let { if (it.isPlaying) it.pause() }; promise.resolve(true) }
  }

  @ReactMethod
  fun playerSeek(sec: Double, promise: Promise) {
    main.post {
      // Un déplacement manuel en dehors des passages choisis quitte le mode « par personne ».
      if (rangeIndex >= 0) {
        val idx = ranges.indexOfFirst { sec >= it.first - 0.05 && sec < it.second }
        if (idx >= 0) rangeIndex = idx else clearRanges()
      }
      seekMs((sec * 1000).toLong())
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun playerSetSpeed(value: Double, promise: Promise) {
    main.post {
      speed = value.toFloat()
      player?.let { if (it.isPlaying) applySpeed(it) }
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun playerPlayRanges(list: ReadableArray, promise: Promise) {
    main.post {
      val p = player
      if (p == null) { promise.resolve(false); return@post }
      val r = ArrayList<Pair<Double, Double>>()
      for (i in 0 until list.size()) {
        val a = list.getArray(i) ?: continue
        r.add(a.getDouble(0) to a.getDouble(1))
      }
      clearRanges()
      if (r.isEmpty()) { promise.resolve(false); return@post }
      ranges = r.sortedBy { it.first }
      rangeIndex = 0
      seekMs((ranges[0].first * 1000).toLong())
      p.start()
      applySpeed(p)
      main.postDelayed(rangeWatcher, 40)
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun playerClearRanges(promise: Promise) { main.post { clearRanges(); promise.resolve(true) } }

  @ReactMethod
  fun playerState(promise: Promise) {
    main.post {
      val m = Arguments.createMap()
      val p = player
      m.putBoolean("loaded", p != null)
      m.putBoolean("playing", p?.isPlaying ?: false)
      m.putDouble("position", (p?.currentPosition ?: 0) / 1000.0)
      m.putDouble("duration", (p?.duration ?: 0) / 1000.0)
      m.putBoolean("ranges", rangeIndex >= 0)
      m.putDouble("speed", speed.toDouble())
      promise.resolve(m)
    }
  }

  @ReactMethod
  fun playerRelease(promise: Promise) {
    main.post {
      clearRanges()
      player?.release()
      player = null
      playerPath = null
      promise.resolve(true)
    }
  }

  // ---------- Export / partage ----------

  @ReactMethod
  fun exportAudio(wavPath: String, outPath: String, list: ReadableArray?, promise: Promise) {
    val r = list?.let { arr ->
      (0 until arr.size()).mapNotNull { i -> arr.getArray(i)?.let { it.getDouble(0) to it.getDouble(1) } }
    }
    Thread {
      try {
        AudioExporter.export(File(wavPath), File(outPath), r)
        promise.resolve(outPath)
      } catch (t: Throwable) { promise.reject("E_EXPORT", t.message ?: t.toString(), t) }
    }.start()
  }

  @ReactMethod
  fun shareFiles(paths: ReadableArray, mime: String, title: String, promise: Promise) {
    try {
      val authority = "${ctx.packageName}.files"
      val uris = ArrayList<android.net.Uri>()
      for (i in 0 until paths.size()) uris.add(FileProvider.getUriForFile(ctx, authority, File(paths.getString(i)!!)))
      val send = if (uris.size == 1) {
        Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_STREAM, uris[0])
      } else {
        Intent(Intent.ACTION_SEND_MULTIPLE).putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
      }
      send.type = mime
      send.putExtra(Intent.EXTRA_SUBJECT, title)
      send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      val chooser = Intent.createChooser(send, title).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      val act = ctx.currentActivity
      if (act != null) act.startActivity(chooser) else ctx.startActivity(chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(true)
    } catch (t: Throwable) { promise.reject("E_SHARE", t.message ?: t.toString(), t) }
  }

  /** Copie un fichier dans Téléchargements/Resona (visible dans l'appli Fichiers). */
  @ReactMethod
  fun saveToDownloads(path: String, displayName: String, mime: String, promise: Promise) {
    Thread {
      try {
        val src = File(path)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, displayName)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Resona")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
          }
          val resolver = ctx.contentResolver
          val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("Impossible de créer le fichier")
          resolver.openOutputStream(uri)!!.use { o -> src.inputStream().use { it.copyTo(o) } }
          values.clear()
          values.put(MediaStore.MediaColumns.IS_PENDING, 0)
          resolver.update(uri, values, null, null)
        } else {
          @Suppress("DEPRECATION")
          val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Resona")
          dir.mkdirs()
          src.copyTo(File(dir, displayName), overwrite = true)
        }
        promise.resolve("Téléchargements/Resona/$displayName")
      } catch (t: Throwable) { promise.reject("E_SAVE", t.message ?: t.toString(), t) }
    }.start()
  }

  // ---------- Retour haptique ----------

  @ReactMethod
  fun haptic(kind: String) {
    val act = ctx.currentActivity ?: return
    act.runOnUiThread {
      val c = when (kind) {
        "success" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
        "heavy" -> HapticFeedbackConstants.LONG_PRESS
        "select" -> HapticFeedbackConstants.CLOCK_TICK
        else -> HapticFeedbackConstants.KEYBOARD_TAP
      }
      act.window?.decorView?.performHapticFeedback(c)
    }
  }

  override fun invalidate() {
    main.removeCallbacks(rangeWatcher)
    main.post { player?.release(); player = null }
    playerThread.quitSafely()
    super.invalidate()
  }
}

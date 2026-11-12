package com.resona.core

import android.content.Intent
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
    val m = Arguments.createMap()
    m.putBoolean("running", ProcessingService.running)
    m.putString("id", ProcessingService.currentId)
    m.putString("stage", ProcessingService.stage)
    m.putDouble("progress", ProcessingService.progress)
    m.putString("error", ProcessingService.error)
    m.putString("finishedId", ProcessingService.finishedId)
    promise.resolve(m)
  }

  @ReactMethod
  fun cancelProcessing(promise: Promise) { ProcessingService.cancelRequested = true; promise.resolve(true) }

  // ---------- Lecture audio ----------

  private var player: MediaPlayer? = null
  private var playerPath: String? = null

  @ReactMethod
  fun playerLoad(path: String, promise: Promise) {
    try {
      if (playerPath == path && player != null) { promise.resolve(player!!.duration / 1000.0); return }
      player?.release()
      val p = MediaPlayer()
      p.setDataSource(path)
      p.prepare()
      player = p
      playerPath = path
      promise.resolve(p.duration / 1000.0)
    } catch (t: Throwable) { promise.reject("E_PLAYER", t) }
  }

  @ReactMethod
  fun playerPlay(promise: Promise) { player?.start(); promise.resolve(true) }

  @ReactMethod
  fun playerPause(promise: Promise) { player?.let { if (it.isPlaying) it.pause() }; promise.resolve(true) }

  @ReactMethod
  fun playerSeek(sec: Double, promise: Promise) {
    player?.let {
      val ms = (sec * 1000).toLong()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) it.seekTo(ms, MediaPlayer.SEEK_CLOSEST) else it.seekTo(ms.toInt())
    }
    promise.resolve(true)
  }

  @ReactMethod
  fun playerState(promise: Promise) {
    val m = Arguments.createMap()
    val p = player
    m.putBoolean("loaded", p != null)
    m.putBoolean("playing", p?.isPlaying ?: false)
    m.putDouble("position", (p?.currentPosition ?: 0) / 1000.0)
    m.putDouble("duration", (p?.duration ?: 0) / 1000.0)
    promise.resolve(m)
  }

  @ReactMethod
  fun playerRelease(promise: Promise) {
    player?.release()
    player = null
    playerPath = null
    promise.resolve(true)
  }

  override fun invalidate() {
    player?.release()
    player = null
    super.invalidate()
  }
}

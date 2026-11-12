package com.resona.core

import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/** Téléchargement des modèles (une seule fois), avec suivi de progression. */
object Downloader {
  data class State(
    @Volatile var bytes: Long = 0,
    @Volatile var total: Long = -1,
    @Volatile var done: Boolean = false,
    @Volatile var error: String? = null,
  )

  val states = ConcurrentHashMap<String, State>()
  private val executor = Executors.newFixedThreadPool(2)

  fun start(key: String, url: String, dest: String) {
    val existing = states[key]
    if (existing != null && !existing.done && existing.error == null) return
    val state = State()
    states[key] = state
    executor.execute {
      try {
        val out = File(dest)
        out.parentFile?.mkdirs()
        val tmp = File("$dest.part")
        var current = url
        var conn: HttpURLConnection
        var redirects = 0
        while (true) {
          conn = URL(current).openConnection() as HttpURLConnection
          conn.connectTimeout = 20000
          conn.readTimeout = 60000
          conn.instanceFollowRedirects = false
          conn.setRequestProperty("User-Agent", "Resona-Android")
          val code = conn.responseCode
          if (code in 300..399 && redirects < 10) {
            current = URL(URL(current), conn.getHeaderField("Location")).toString()
            conn.disconnect()
            redirects++
            continue
          }
          if (code !in 200..299) throw IllegalStateException("HTTP $code")
          break
        }
        state.total = conn.contentLengthLong
        conn.inputStream.use { input ->
          tmp.outputStream().use { output ->
            val buf = ByteArray(1 shl 16)
            while (true) {
              val n = input.read(buf)
              if (n < 0) break
              output.write(buf, 0, n)
              state.bytes += n
            }
          }
        }
        conn.disconnect()
        if (state.total > 0 && tmp.length() != state.total) throw IllegalStateException("Téléchargement incomplet")
        if (out.exists()) out.delete()
        if (!tmp.renameTo(out)) throw IllegalStateException("Impossible d'écrire le fichier")
        state.done = true
      } catch (t: Throwable) {
        state.error = t.message ?: t.toString()
        File("$dest.part").delete()
      }
    }
  }
}

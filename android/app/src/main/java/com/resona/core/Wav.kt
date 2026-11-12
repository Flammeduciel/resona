package com.resona.core

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Petits utilitaires WAV PCM 16 bits mono. */
object Wav {
  const val SAMPLE_RATE = 16000

  fun writeHeader(raf: RandomAccessFile, dataBytes: Long, sampleRate: Int = SAMPLE_RATE) {
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    header.put("RIFF".toByteArray())
    header.putInt((36 + dataBytes).toInt())
    header.put("WAVE".toByteArray())
    header.put("fmt ".toByteArray())
    header.putInt(16)
    header.putShort(1) // PCM
    header.putShort(1) // mono
    header.putInt(sampleRate)
    header.putInt(sampleRate * 2) // byte rate
    header.putShort(2) // block align
    header.putShort(16) // bits per sample
    header.put("data".toByteArray())
    header.putInt(dataBytes.toInt())
    val pos = raf.filePointer
    raf.seek(0)
    raf.write(header.array())
    if (pos > 44) raf.seek(pos)
  }

  data class Info(val sampleRate: Int, val channels: Int, val bits: Int, val dataOffset: Long, val dataBytes: Long) {
    val durationSec: Double
      get() = if (sampleRate == 0) 0.0 else dataBytes.toDouble() / (sampleRate * channels * (bits / 8))
  }

  fun info(file: File): Info {
    RandomAccessFile(file, "r").use { raf ->
      val fileLen = raf.length()
      val head = ByteArray(12)
      raf.readFully(head)
      var sampleRate = SAMPLE_RATE
      var channels = 1
      var bits = 16
      var pos = 12L
      while (pos + 8 <= fileLen) {
        raf.seek(pos)
        val idBytes = ByteArray(4)
        raf.readFully(idBytes)
        val sizeBuf = ByteArray(4)
        raf.readFully(sizeBuf)
        val size = ByteBuffer.wrap(sizeBuf).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xffffffffL
        val id = String(idBytes)
        if (id == "fmt ") {
          val fmt = ByteArray(16)
          raf.readFully(fmt)
          val bb = ByteBuffer.wrap(fmt).order(ByteOrder.LITTLE_ENDIAN)
          bb.short
          channels = bb.short.toInt()
          sampleRate = bb.int
          bb.int
          bb.short
          bits = bb.short.toInt()
        } else if (id == "data") {
          // Si l'enregistrement a été interrompu, l'en-tête peut être faux : on se fie à la taille du fichier.
          val real = fileLen - (pos + 8)
          val bytes = if (size == 0L || size > real) real else size
          return Info(sampleRate, channels, bits, pos + 8, bytes)
        }
        pos += 8 + size + (size and 1)
      }
      return Info(sampleRate, channels, bits, 44, maxOf(0, fileLen - 44))
    }
  }

  /** Répare l'en-tête d'un fichier dont l'écriture a été interrompue. */
  fun repair(file: File) {
    if (!file.exists() || file.length() < 44) return
    RandomAccessFile(file, "rw").use { raf -> writeHeader(raf, raf.length() - 44) }
  }

  /** Charge le WAV (16 bits) en float [-1, 1], mono, sans copie intermédiaire. */
  fun readFloats(file: File): Pair<FloatArray, Int> {
    val info = info(file)
    require(info.bits == 16) { "Seuls les WAV 16 bits sont supportés" }
    val frames = (info.dataBytes / (2 * info.channels)).toInt()
    val out = FloatArray(frames)
    RandomAccessFile(file, "r").use { raf ->
      raf.seek(info.dataOffset)
      val chunk = ByteArray(1 shl 16)
      val bb = ByteBuffer.wrap(chunk).order(ByteOrder.LITTLE_ENDIAN)
      var frame = 0
      var leftover = 0
      while (frame < frames) {
        val n = raf.read(chunk, leftover, chunk.size - leftover)
        if (n <= 0) break
        val total = leftover + n
        val frameBytes = 2 * info.channels
        val usable = total - (total % frameBytes)
        bb.position(0)
        var i = 0
        while (i < usable && frame < frames) {
          var acc = 0f
          for (c in 0 until info.channels) acc += bb.getShort(i + 2 * c) / 32768f
          out[frame++] = acc / info.channels
          i += frameBytes
        }
        leftover = total - usable
        if (leftover > 0) System.arraycopy(chunk, usable, chunk, 0, leftover)
      }
    }
    return Pair(out, info.sampleRate)
  }
}

package com.resona.core

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer

/**
 * Exporte tout ou partie d'un WAV en M4A (AAC), un format léger lisible partout
 * (une heure de réunion ≈ 20 Mo au lieu de 115 Mo en WAV).
 *
 * Avec des plages (start/end en secondes), seuls ces passages sont gardés, séparés par un court
 * silence : c'est ce qui permet d'exporter « uniquement ce qu'a dit John ».
 */
object AudioExporter {
  private const val BITRATE = 64_000
  private const val GAP_SEC = 0.35

  fun export(wav: File, out: File, ranges: List<Pair<Double, Double>>?, onProgress: (Double) -> Unit = {}) {
    val info = Wav.info(wav)
    require(info.bits == 16) { "Seuls les WAV 16 bits sont supportés" }
    val sr = info.sampleRate
    val ch = info.channels
    val frameBytes = 2 * ch
    val totalFrames = info.dataBytes / frameBytes
    val segs: List<Pair<Long, Long>> = (ranges ?: listOf(0.0 to totalFrames.toDouble() / sr))
      .map { (s, e) -> ((s * sr).toLong().coerceIn(0, totalFrames)) to ((e * sr).toLong().coerceIn(0, totalFrames)) }
      .filter { it.second > it.first }
    require(segs.isNotEmpty()) { "Rien à exporter" }
    val gapFrames = if (ranges != null) (GAP_SEC * sr).toLong() else 0L
    val framesToWrite = segs.sumOf { it.second - it.first } + gapFrames * (segs.size - 1)

    out.parentFile?.mkdirs()
    if (out.exists()) out.delete()

    val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sr, ch).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
    }
    val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    codec.start()
    val muxer = MediaMuxer(out.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    var track = -1
    var muxerStarted = false
    val bufInfo = MediaCodec.BufferInfo()

    val raf = RandomAccessFile(wav, "r")
    // Source PCM : les plages à la suite, avec des silences entre elles.
    var segIndex = 0
    var posInSeg = 0L
    var gapLeft = 0L
    var framesFed = 0L
    var inputDone = false
    var outputDone = false
    val chunk = ByteArray(8192 - (8192 % frameBytes))

    fun readSource(dst: ByteBuffer): Int {
      var written = 0
      while (dst.remaining() >= frameBytes && segIndex < segs.size) {
        if (gapLeft > 0) {
          val n = minOf(gapLeft, (dst.remaining() / frameBytes).toLong()).toInt()
          dst.put(ByteArray(n * frameBytes))
          gapLeft -= n
          written += n * frameBytes
          continue
        }
        val (s, e) = segs[segIndex]
        val remainingFrames = e - s - posInSeg
        if (remainingFrames <= 0) {
          segIndex++
          posInSeg = 0
          if (segIndex < segs.size) gapLeft = gapFrames
          continue
        }
        val n = minOf(remainingFrames, (minOf(dst.remaining(), chunk.size) / frameBytes).toLong()).toInt()
        raf.seek(info.dataOffset + (s + posInSeg) * frameBytes)
        raf.readFully(chunk, 0, n * frameBytes)
        dst.put(chunk, 0, n * frameBytes)
        posInSeg += n
        written += n * frameBytes
      }
      return written
    }

    try {
      while (!outputDone) {
        if (!inputDone) {
          val inIdx = codec.dequeueInputBuffer(10_000)
          if (inIdx >= 0) {
            val inBuf = codec.getInputBuffer(inIdx)!!
            inBuf.clear()
            val n = readSource(inBuf)
            val ptsUs = framesFed * 1_000_000L / sr
            if (n <= 0) {
              codec.queueInputBuffer(inIdx, 0, 0, ptsUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              codec.queueInputBuffer(inIdx, 0, n, ptsUs, 0)
              framesFed += n / frameBytes
              onProgress(framesFed.toDouble() / framesToWrite)
            }
          }
        }
        val outIdx = codec.dequeueOutputBuffer(bufInfo, 10_000)
        when {
          outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            track = muxer.addTrack(codec.outputFormat)
            muxer.start()
            muxerStarted = true
          }
          outIdx >= 0 -> {
            val outBuf = codec.getOutputBuffer(outIdx)!!
            if (bufInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) bufInfo.size = 0
            if (bufInfo.size > 0 && muxerStarted) {
              outBuf.position(bufInfo.offset)
              outBuf.limit(bufInfo.offset + bufInfo.size)
              muxer.writeSampleData(track, outBuf, bufInfo)
            }
            codec.releaseOutputBuffer(outIdx, false)
            if (bufInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
          }
        }
      }
    } finally {
      raf.close()
      try { codec.stop() } catch (_: Throwable) {}
      codec.release()
      try { if (muxerStarted) muxer.stop() } catch (_: Throwable) {}
      muxer.release()
    }
    onProgress(1.0)
  }
}

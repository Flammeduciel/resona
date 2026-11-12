package com.resona.core

import com.k2fsa.sherpa.onnx.FastClusteringConfig
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarization
import com.k2fsa.sherpa.onnx.OfflineSpeakerDiarizationConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationModelConfig
import com.k2fsa.sherpa.onnx.OfflineSpeakerSegmentationPyannoteModelConfig
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Paramètres d'une analyse locale. */
data class ProcessOptions(
  val id: String,
  val wavPath: String,
  val outPath: String,
  val segmentationModel: String,
  val embeddingModel: String,
  val whisperEncoder: String?,
  val whisperDecoder: String?,
  val whisperTokens: String?,
  val language: String,
  val numSpeakers: Int,
  val threshold: Float,
  val threads: Int,
)

class CancelledException : Exception("Annulé")

/**
 * Pipeline 100 % local :
 *  1. diarisation (pyannote segmentation + empreintes vocales + clustering) → « qui parle quand » ;
 *  2. transcription Whisper de chaque tour de parole → « qui dit quoi ».
 */
class Processor(
  private val opts: ProcessOptions,
  private val onProgress: (stage: String, progress: Double) -> Unit,
  private val isCancelled: () -> Boolean,
) {

  data class Turn(val start: Float, val end: Float, val speaker: Int, var text: String = "")

  fun run() {
    onProgress("Lecture de l'audio", 0.0)
    val (samples, sampleRate) = Wav.readFloats(File(opts.wavPath))
    if (sampleRate != Wav.SAMPLE_RATE) throw IllegalArgumentException("Fréquence $sampleRate Hz non supportée (16 kHz attendu)")
    val duration = samples.size.toFloat() / sampleRate
    if (duration < 1f) throw IllegalArgumentException("Enregistrement trop court")
    checkCancel()

    val withAsr = opts.whisperEncoder != null && opts.whisperDecoder != null && opts.whisperTokens != null
    val diarShare = if (withAsr) 0.35 else 1.0

    // 1. Diarisation
    onProgress("Reconnaissance des voix", 0.0)
    val diarConfig = OfflineSpeakerDiarizationConfig(
      segmentation = OfflineSpeakerSegmentationModelConfig(
        pyannote = OfflineSpeakerSegmentationPyannoteModelConfig(model = opts.segmentationModel),
        numThreads = opts.threads,
      ),
      embedding = SpeakerEmbeddingExtractorConfig(model = opts.embeddingModel, numThreads = opts.threads),
      clustering = FastClusteringConfig(
        numClusters = if (opts.numSpeakers > 0) opts.numSpeakers else -1,
        threshold = opts.threshold,
      ),
      minDurationOn = 0.3f,
      minDurationOff = 0.5f,
    )
    val diar = OfflineSpeakerDiarization(config = diarConfig)
    val raw = try {
      diar.processWithCallback(samples, { done: Int, total: Int, _: Long ->
        if (total > 0) onProgress("Reconnaissance des voix", diarShare * done / total)
        if (isCancelled()) 1 else 0
      }, 0L)
    } finally {
      diar.release()
    }
    checkCancel()

    var turns = raw.sortedBy { it.start }.map { Turn(it.start, it.end, it.speaker) }
    if (turns.isEmpty()) turns = listOf(Turn(0f, duration, 0))
    turns = renumberSpeakers(mergeTurns(turns))

    // 2. Transcription
    if (withAsr) {
      onProgress("Transcription", diarShare)
      val recognizer = OfflineRecognizer(
        config = OfflineRecognizerConfig(
          featConfig = FeatureConfig(sampleRate = Wav.SAMPLE_RATE, featureDim = 80),
          modelConfig = OfflineModelConfig(
            whisper = OfflineWhisperModelConfig(
              encoder = opts.whisperEncoder!!,
              decoder = opts.whisperDecoder!!,
              language = opts.language,
              task = "transcribe",
            ),
            tokens = opts.whisperTokens!!,
            numThreads = opts.threads,
            modelType = "whisper",
          ),
          decodingMethod = "greedy_search",
        ),
      )
      try {
        val totalSec = turns.sumOf { (it.end - it.start).toDouble() }.coerceAtLeast(0.001)
        var doneSec = 0.0
        for (turn in turns) {
          checkCancel()
          val parts = ArrayList<String>()
          for ((s, e) in splitWindows(turn.start, turn.end)) {
            val text = transcribe(recognizer, samples, s, e)
            if (text.isNotEmpty()) parts.add(text)
          }
          turn.text = parts.joinToString(" ")
          doneSec += turn.end - turn.start
          onProgress("Transcription", diarShare + (1 - diarShare) * (doneSec / totalSec))
        }
      } finally {
        recognizer.release()
      }
    }

    writeResult(turns, duration, withAsr)
    onProgress("Terminé", 1.0)
  }

  private fun checkCancel() { if (isCancelled()) throw CancelledException() }

  /** Fusionne les tours consécutifs d'une même voix (petits silences) pour des blocs lisibles. */
  private fun mergeTurns(input: List<Turn>): List<Turn> {
    val out = ArrayList<Turn>()
    for (t in input) {
      if (t.end - t.start < 0.25f) continue
      val last = out.lastOrNull()
      if (last != null && last.speaker == t.speaker && t.start - last.end < 1.0f && t.end - last.start <= 60f) {
        out[out.size - 1] = Turn(last.start, maxOf(last.end, t.end), last.speaker)
      } else {
        out.add(t.copy())
      }
    }
    return out
  }

  /** Numérote les voix dans l'ordre d'apparition : la première personne qui parle devient la voix 0 (A). */
  private fun renumberSpeakers(input: List<Turn>): List<Turn> {
    val map = LinkedHashMap<Int, Int>()
    return input.map { t -> t.copy(speaker = map.getOrPut(t.speaker) { map.size }) }
  }

  /** Whisper traite au plus 30 s : on découpe les longs tours en fenêtres de ~25 s. */
  private fun splitWindows(start: Float, end: Float): List<Pair<Float, Float>> {
    val max = 25f
    if (end - start <= 28f) return listOf(start to end)
    val res = ArrayList<Pair<Float, Float>>()
    var s = start
    while (s < end) {
      val e = minOf(end, s + max)
      res.add(s to e)
      s = e
    }
    // évite un dernier morceau minuscule
    if (res.size >= 2 && res.last().second - res.last().first < 3f) {
      val a = res.removeAt(res.size - 1)
      val b = res.removeAt(res.size - 1)
      res.add(b.first to a.second)
    }
    return res
  }

  private fun transcribe(recognizer: OfflineRecognizer, samples: FloatArray, start: Float, end: Float): String {
    val sr = Wav.SAMPLE_RATE
    // petite marge autour du tour de parole pour ne pas couper les mots
    val from = ((start - 0.15f) * sr).toInt().coerceIn(0, samples.size)
    val to = ((end + 0.15f) * sr).toInt().coerceIn(0, samples.size)
    if (to - from < sr * 0.4f) return ""
    val slice = samples.copyOfRange(from, to)
    val stream = recognizer.createStream()
    return try {
      stream.acceptWaveform(slice, sr)
      recognizer.decode(stream)
      cleanText(recognizer.getResult(stream).text)
    } finally {
      stream.release()
    }
  }

  private val hallucinations = listOf(
    "sous-titres réalisés par", "sous-titrage", "amara.org", "merci d'avoir regardé",
    "abonnez-vous", "thanks for watching", "subtitles by",
  )

  private fun cleanText(text: String): String {
    val t = text.trim()
    val lower = t.lowercase()
    if (hallucinations.any { lower.contains(it) }) return ""
    if (t.matches(Regex("^[\\p{Punct}\\s…]*$"))) return ""
    return t
  }

  private fun writeResult(turns: List<Turn>, duration: Float, withAsr: Boolean) {
    val arr = JSONArray()
    for (t in turns) {
      arr.put(JSONObject().apply {
        put("start", t.start.toDouble())
        put("end", t.end.toDouble())
        put("speaker", t.speaker)
        put("text", t.text)
      })
    }
    val json = JSONObject().apply {
      put("engine", "local")
      put("transcribed", withAsr)
      put("duration", duration.toDouble())
      put("numSpeakers", turns.map { it.speaker }.distinct().size)
      put("segments", arr)
      put("createdAt", System.currentTimeMillis())
    }
    val out = File(opts.outPath)
    out.parentFile?.mkdirs()
    val tmp = File(out.path + ".tmp")
    tmp.writeText(json.toString())
    tmp.renameTo(out)
  }
}

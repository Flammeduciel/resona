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
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractor
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
      // Volontairement fin : on découpe large, puis on regroupe nous-mêmes (regroup / reassign),
      // ce qui marche bien mieux que le clustering intégré (2 personnes → 6 voix, ou mélanges).
      clustering = FastClusteringConfig(numClusters = -1, threshold = 0.5f),
      minDurationOn = 0.3f,
      minDurationOff = 0.5f,
    )
    val diar = OfflineSpeakerDiarization(config = diarConfig)
    // Note : on n'utilise PAS processWithCallback. Son pont JNI cherche une méthode « invoke » que
    // les lambdas Kotlin n'exposent pas : NoSuchMethodError côté natif, ce qui fait planter l'app.
    // On affiche une progression estimée pendant le calcul.
    val ticker = progressTicker("Reconnaissance des voix", 0.0, diarShare * 0.95, estimatedSec = duration * 0.12f)
    val raw = try {
      diar.process(samples)
    } finally {
      ticker.interrupt()
      diar.release()
    }
    onProgress("Reconnaissance des voix", diarShare)
    checkCancel()

    var turns = raw.sortedBy { it.start }.map { Turn(it.start, it.end, it.speaker) }
    if (turns.isEmpty()) turns = listOf(Turn(0f, duration, 0))
    // Regroupement par personne puis réattribution fine (voir regroup / reassign).
    onProgress("Regroupement des voix", diarShare)
    val extractor = SpeakerEmbeddingExtractor(config = SpeakerEmbeddingExtractorConfig(model = opts.embeddingModel, numThreads = opts.threads))
    val voices: List<Voice>
    try {
      turns = regroup(samples, extractor, turns)
      checkCancel()
      turns = reassign(samples, extractor, turns)
      turns = renumberSpeakers(mergeTurns(turns))
      // empreinte de chaque personne : l'interface s'en sert pour fusionner instantanément
      voices = voiceprints(samples, extractor, turns)
    } finally {
      extractor.release()
    }

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

    writeResult(turns, voices, duration, withAsr)
    onProgress("Terminé", 1.0)
  }

  data class Voice(val id: Int, val duration: Double, val embedding: FloatArray?)

  /** Empreinte normalisée d'un passage, ou null s'il est trop court. */
  private fun embed(samples: FloatArray, ex: SpeakerEmbeddingExtractor, start: Float, end: Float): FloatArray? {
    val sr = Wav.SAMPLE_RATE
    val from = (start * sr).toInt().coerceIn(0, samples.size)
    val to = (maxOf(end, start + 0.6f) * sr).toInt().coerceIn(from, samples.size)
    if (to - from < sr / 4) return null
    val stream = ex.createStream()
    return try {
      stream.acceptWaveform(samples.copyOfRange(from, to), sr)
      stream.inputFinished()
      if (ex.isReady(stream)) normalize(ex.compute(stream)) else null
    } finally {
      stream.release()
    }
  }

  /** Empreinte moyenne (pondérée par la durée) de chaque voix, sur ses 12 plus longs passages. */
  private fun centroids(samples: FloatArray, ex: SpeakerEmbeddingExtractor, turns: List<Turn>): Map<Int, FloatArray> {
    val out = HashMap<Int, FloatArray>()
    for ((spk, list) in turns.groupBy { it.speaker }) {
      checkCancel()
      var cand = list.sortedByDescending { it.end - it.start }.take(12)
      cand = cand.filter { it.end - it.start >= 1f }.ifEmpty { cand.take(1) }
      val acc = FloatArray(ex.dim())
      var any = false
      for (t in cand) {
        val e = embed(samples, ex, t.start, t.end) ?: continue
        val w = t.end - t.start
        for (i in acc.indices) acc[i] += e[i] * w
        any = true
      }
      if (any) out[spk] = normalize(acc)
    }
    return out
  }

  private fun voiceprints(samples: FloatArray, ex: SpeakerEmbeddingExtractor, turns: List<Turn>): List<Voice> {
    val c = centroids(samples, ex, turns)
    return turns.groupBy { it.speaker }.toSortedMap().map { (spk, list) ->
      Voice(spk, list.sumOf { (it.end - it.start).toDouble() }, c[spk])
    }
  }

  /**
   * Regroupe les voix brutes qui appartiennent à la même personne (le découpage initial est
   * volontairement trop fin : une personne peut y apparaître 5 à 15 fois).
   *  1. fusion des empreintes les plus proches tant que la similarité ≥ seuil ;
   *  2. rattachement des voix minuscules (< 4 s ou < 4 % du temps) à la plus proche ;
   *  3. si le nombre de participants est connu, fusion jusqu'à ce nombre.
   * Même algorithme que src/grouping.ts. Validé sur des réunions de test de 2 à 4 personnes.
   */
  private fun regroup(samples: FloatArray, ex: SpeakerEmbeddingExtractor, turns: List<Turn>): List<Turn> {
    val bySpeaker = turns.groupBy { it.speaker }
    if (bySpeaker.size <= 1) return turns
    val embs = HashMap(centroids(samples, ex, turns))
    val dur = HashMap<Int, Double>()
    for ((k, l) in bySpeaker) dur[k] = l.sumOf { (it.end - it.start).toDouble() }
    val mapping = HashMap<Int, Int>()
    for (k in bySpeaker.keys) mapping[k] = k
    val main = dur.maxByOrNull { it.value }!!.key
    for (k in bySpeaker.keys) if (k !in embs && main in embs) mapping[k] = main
    dur.keys.retainAll(embs.keys)
    if (embs.isEmpty()) return turns

    fun merge(x: Int, y: Int) {
      val (a, b) = if (dur[x]!! >= dur[y]!!) x to y else y to x
      val ea = embs[a]!!; val eb = embs[b]!!; val da = dur[a]!!; val db = dur[b]!!
      embs[a] = normalize(FloatArray(ea.size) { (ea[it] * da + eb[it] * db).toFloat() })
      dur[a] = da + db
      embs.remove(b); dur.remove(b)
      for (k in mapping.keys.toList()) if (mapping[k] == b) mapping[k] = a
    }
    fun bestPair(): Triple<Float, Int, Int>? {
      val ks = embs.keys.toList()
      var best: Triple<Float, Int, Int>? = null
      for (i in ks.indices) for (j in i + 1 until ks.size) {
        val sim = dot(embs[ks[i]]!!, embs[ks[j]]!!)
        if (best == null || sim > best.first) best = Triple(sim, ks[i], ks[j])
      }
      return best
    }
    val target = opts.numSpeakers
    fun more() = embs.size > 1 && (target <= 0 || embs.size > target)

    while (more()) {
      val (sim, a, b) = bestPair() ?: break
      if (sim < opts.threshold) break
      merge(a, b)
    }
    val total = dur.values.sum()
    while (more()) {
      val small = dur.minByOrNull { it.value }!!.key
      if (dur[small]!! >= maxOf(4.0, 0.04 * total)) break
      val near = embs.keys.filter { it != small }.maxByOrNull { dot(embs[small]!!, embs[it]!!) }!!
      merge(near, small)
    }
    while (target > 0 && embs.size > target) {
      val (_, a, b) = bestPair() ?: break
      merge(a, b)
    }
    return turns.map { it.copy(speaker = mapping[it.speaker] ?: it.speaker) }
  }

  /**
   * Quand deux personnes s'enchaînent sans vraie pause, le premier passage les confond souvent.
   * On recoupe donc les longs passages aux micro-pauses, puis chaque morceau est réattribué à la
   * personne dont l'empreinte est nettement la plus proche (+9 points de précision à 4 personnes).
   */
  private fun reassign(samples: FloatArray, ex: SpeakerEmbeddingExtractor, turns: List<Turn>): List<Turn> {
    val cent = centroids(samples, ex, turns)
    if (cent.size <= 1) return turns
    val out = ArrayList<Turn>()
    for (t in turns) {
      val pieces = if (t.end - t.start >= 1.6f) splitAtPauses(samples, t.start, t.end) else listOf(t.start to t.end)
      if (pieces.size == 1) { out.add(t); continue }
      checkCancel()
      for ((a, b) in pieces) {
        val own = cent[t.speaker]
        val e = if (b - a >= 0.8f && own != null) embed(samples, ex, a, b) else null
        var spk = t.speaker
        if (e != null) {
          val best = cent.maxByOrNull { dot(e, it.value) }!!
          if (dot(e, best.value) - dot(e, own!!) > 0.08f) spk = best.key
        }
        out.add(Turn(a, b, spk))
      }
    }
    return out
  }

  /** Découpe [start, end] aux pauses internes (énergie basse pendant ≥ 0,2 s). */
  private fun splitAtPauses(samples: FloatArray, start: Float, end: Float): List<Pair<Float, Float>> {
    val sr = Wav.SAMPLE_RATE
    val win = 0.02f
    val n = (win * sr).toInt()
    val from = (start * sr).toInt().coerceIn(0, samples.size)
    val to = (end * sr).toInt().coerceIn(from, samples.size)
    val frames = (to - from) / n
    if (frames < 10) return listOf(start to end)
    val e = FloatArray(frames) { f ->
      var acc = 0.0
      val base = from + f * n
      for (i in 0 until n) { val x = samples[base + i]; acc += x * x }
      Math.sqrt(acc / n + 1e-12).toFloat()
    }
    val sorted = e.sortedArray()
    val thr = maxOf(sorted[(frames * 0.15).toInt()] * 1.8f, sorted.last() * 0.05f)
    val cuts = ArrayList<Float>()
    var i = 0
    while (i < frames) {
      if (e[i] < thr) {
        var j = i
        while (j < frames && e[j] < thr) j++
        if ((j - i) * win >= 0.2f && i > 0 && j < frames) cuts.add(start + (i + j) / 2f * win)
        i = j
      } else i++
    }
    val pts = listOf(start) + cuts + listOf(end)
    return (0 until pts.size - 1).map { pts[it] to pts[it + 1] }
  }

  private fun dot(a: FloatArray, b: FloatArray): Float {
    var s = 0f
    for (i in a.indices) s += a[i] * b[i]
    return s
  }

  private fun normalize(v: FloatArray): FloatArray {
    var n = 0.0
    for (x in v) n += x * x
    val inv = if (n > 0) (1.0 / Math.sqrt(n)).toFloat() else 0f
    return FloatArray(v.size) { v[it] * inv }
  }

  /** Fait avancer la barre de progression pendant un calcul natif qui ne donne pas de nouvelles. */
  private fun progressTicker(stage: String, from: Double, to: Double, estimatedSec: Float): Thread {
    val t = Thread {
      val startMs = System.currentTimeMillis()
      val est = maxOf(2.0, estimatedSec.toDouble()) * 1000
      try {
        while (true) {
          val x = (System.currentTimeMillis() - startMs) / est
          // courbe qui tend vers 1 sans jamais l'atteindre
          onProgress(stage, from + (to - from) * (1 - Math.exp(-2 * x)))
          Thread.sleep(500)
        }
      } catch (_: InterruptedException) {}
    }
    t.isDaemon = true
    t.start()
    return t
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

  private fun writeResult(turns: List<Turn>, voices: List<Voice>, duration: Float, withAsr: Boolean) {
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
      put("version", 2)
      put("voices", JSONArray().apply {
        for (v in voices) put(JSONObject().apply {
          put("id", v.id)
          put("duration", v.duration)
          if (v.embedding != null) put("embedding", JSONArray().apply { v.embedding.forEach { x -> put(Math.round(x * 10000) / 10000.0) } })
        })
      })
      put("createdAt", System.currentTimeMillis())
    }
    val out = File(opts.outPath)
    out.parentFile?.mkdirs()
    val tmp = File(out.path + ".tmp")
    tmp.writeText(json.toString())
    tmp.renameTo(out)
  }
}

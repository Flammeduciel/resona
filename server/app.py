"""
Serveur d'analyse Resona (optionnel).

Même pipeline que l'application (sherpa-onnx : diarisation pyannote + TitaNet, puis Whisper),
mais sur une machine plus puissante, ce qui permet d'utiliser un modèle Whisper plus gros.

Contrat attendu par l'application :
  POST /analyze   multipart/form-data
     audio         fichier WAV 16 kHz mono (envoyé par l'appli)
     language      "fr" | "en" | "auto"
     num_speakers  "0" (auto) ou nombre de participants
  En-tête facultatif : Authorization: Bearer <RESONA_API_KEY>
  Réponse : {"segments": [{"start": 0.0, "end": 3.2, "speaker": 0, "text": "..."}], "transcribed": true}

Lancement :
  pip install -r requirements.txt
  python download_models.py           # télécharge les modèles dans ./models
  RESONA_API_KEY=secret uvicorn app:app --host 0.0.0.0 --port 8000
"""

import io
import os

import numpy as np
import sherpa_onnx
import soundfile as sf
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from scipy.signal import resample_poly

MODELS = os.environ.get("RESONA_MODELS", os.path.join(os.path.dirname(__file__), "models"))
WHISPER = os.environ.get("RESONA_WHISPER", "small")
THREADS = int(os.environ.get("RESONA_THREADS", "4"))
API_KEY = os.environ.get("RESONA_API_KEY", "")
SR = 16000

app = FastAPI(title="Resona server")
_recognizers: dict[str, sherpa_onnx.OfflineRecognizer] = {}


def recognizer(language: str) -> sherpa_onnx.OfflineRecognizer:
    lang = "" if language == "auto" else language
    if lang not in _recognizers:
        _recognizers[lang] = sherpa_onnx.OfflineRecognizer.from_whisper(
            encoder=f"{MODELS}/{WHISPER}-encoder.int8.onnx",
            decoder=f"{MODELS}/{WHISPER}-decoder.int8.onnx",
            tokens=f"{MODELS}/{WHISPER}-tokens.txt",
            language=lang,
            task="transcribe",
            num_threads=THREADS,
        )
    return _recognizers[lang]


def diarize(audio: np.ndarray, num_speakers: int):
    cfg = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=f"{MODELS}/pyannote-segmentation-3.0.onnx"),
            num_threads=THREADS,
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=f"{MODELS}/titanet-small.onnx", num_threads=THREADS),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=num_speakers if num_speakers > 0 else -1, threshold=0.6),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    segs = sherpa_onnx.OfflineSpeakerDiarization(cfg).process(audio).sort_by_start_time()
    turns: list[list] = []
    for s in segs:
        if s.end - s.start < 0.25:
            continue
        if turns and turns[-1][2] == s.speaker and s.start - turns[-1][1] < 1.0 and s.end - turns[-1][0] <= 60:
            turns[-1][1] = max(turns[-1][1], s.end)
        else:
            turns.append([s.start, s.end, s.speaker])
    if not turns:
        turns = [[0.0, len(audio) / SR, 0]]
    order: dict[int, int] = {}
    for t in turns:
        t[2] = order.setdefault(t[2], len(order))
    return turns


def windows(start: float, end: float):
    if end - start <= 28:
        return [(start, end)]
    out, s = [], start
    while s < end:
        out.append((s, min(end, s + 25)))
        s += 25
    return out


@app.post("/analyze")
async def analyze(
    audio: UploadFile = File(...),
    language: str = Form("fr"),
    num_speakers: int = Form(0),
    authorization: str | None = Header(default=None),
):
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="Clé d'API invalide")
    data, sr = sf.read(io.BytesIO(await audio.read()), dtype="float32", always_2d=True)
    samples = data.mean(axis=1).astype(np.float32)
    if sr != SR:
        samples = resample_poly(samples, SR, sr).astype(np.float32)

    rec = recognizer(language)
    segments = []
    for start, end, speaker in diarize(samples, num_speakers):
        texts = []
        for a, b in windows(start, end):
            i0, i1 = max(0, int((a - 0.15) * SR)), min(len(samples), int((b + 0.15) * SR))
            if i1 - i0 < SR * 0.4:
                continue
            stream = rec.create_stream()
            stream.accept_waveform(SR, samples[i0:i1])
            rec.decode_stream(stream)
            if stream.result.text.strip():
                texts.append(stream.result.text.strip())
        segments.append({"start": round(start, 2), "end": round(end, 2), "speaker": speaker, "text": " ".join(texts)})
    return {"segments": segments, "transcribed": True}


@app.get("/health")
def health():
    return {"ok": True, "whisper": WHISPER}

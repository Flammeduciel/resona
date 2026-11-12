"""Télécharge les modèles utilisés par le serveur Resona dans ./models."""

import os
import sys
import urllib.request

WHISPER = os.environ.get("RESONA_WHISPER", "small")
DEST = os.environ.get("RESONA_MODELS", os.path.join(os.path.dirname(__file__), "models"))
HF = "https://huggingface.co/csukuangfj"
GH = "https://github.com/k2-fsa/sherpa-onnx/releases/download"

FILES = {
    "pyannote-segmentation-3.0.onnx": f"{HF}/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx",
    "titanet-small.onnx": f"{GH}/speaker-recongition-models/nemo_en_titanet_small.onnx",
    f"{WHISPER}-encoder.int8.onnx": f"{HF}/sherpa-onnx-whisper-{WHISPER}/resolve/main/{WHISPER}-encoder.int8.onnx",
    f"{WHISPER}-decoder.int8.onnx": f"{HF}/sherpa-onnx-whisper-{WHISPER}/resolve/main/{WHISPER}-decoder.int8.onnx",
    f"{WHISPER}-tokens.txt": f"{HF}/sherpa-onnx-whisper-{WHISPER}/resolve/main/{WHISPER}-tokens.txt",
}

os.makedirs(DEST, exist_ok=True)
for name, url in FILES.items():
    path = os.path.join(DEST, name)
    if os.path.exists(path):
        print("déjà présent :", name)
        continue
    print("téléchargement :", name)
    urllib.request.urlretrieve(url, path + ".part")
    os.replace(path + ".part", path)
print("Modèles prêts dans", DEST, file=sys.stderr)

import { getPaths, Resona } from './native';

/**
 * Catalogue des modèles locaux. Ils sont téléchargés une seule fois puis tout fonctionne hors ligne.
 */
export type ModelFile = { key: string; url: string; file: string; size: number };
export type ModelPack = { id: string; label: string; description: string; files: ModelFile[] };

const HF = 'https://huggingface.co/csukuangfj';
const GH = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

export const DIARIZATION_PACK: ModelPack = {
  id: 'voices',
  label: 'Reconnaissance des voix',
  description: 'Indispensable : détecte qui parle et quand.',
  files: [
    {
      key: 'seg',
      url: `${HF}/sherpa-onnx-pyannote-segmentation-3-0/resolve/main/model.onnx`,
      file: 'pyannote-segmentation-3.0.onnx',
      size: 5992913,
    },
    {
      key: 'emb',
      url: `${GH}/speaker-recongition-models/nemo_en_titanet_small.onnx`,
      file: 'titanet-small.onnx',
      size: 40257283,
    },
  ],
};

export type WhisperSize = 'tiny' | 'base' | 'small';

const WHISPER_SIZES: Record<WhisperSize, { enc: number; dec: number; tok: number; label: string; description: string }> = {
  tiny: { enc: 12937772, dec: 89855401, tok: 816730, label: 'Whisper Tiny', description: 'Très rapide, précision limitée.' },
  base: { enc: 29120534, dec: 130672026, tok: 816730, label: 'Whisper Base', description: 'Bon compromis vitesse / qualité (recommandé).' },
  small: { enc: 112442483, dec: 262226114, tok: 816730, label: 'Whisper Small', description: 'Plus précis, nettement plus lent.' },
};

export function whisperPack(size: WhisperSize): ModelPack {
  const s = WHISPER_SIZES[size];
  const base = `${HF}/sherpa-onnx-whisper-${size}/resolve/main`;
  return {
    id: `whisper-${size}`,
    label: s.label,
    description: s.description,
    files: [
      { key: 'enc', url: `${base}/${size}-encoder.int8.onnx`, file: `whisper-${size}-encoder.int8.onnx`, size: s.enc },
      { key: 'dec', url: `${base}/${size}-decoder.int8.onnx`, file: `whisper-${size}-decoder.int8.onnx`, size: s.dec },
      { key: 'tok', url: `${base}/${size}-tokens.txt`, file: `whisper-${size}-tokens.txt`, size: s.tok },
    ],
  };
}

export const WHISPER_OPTIONS: WhisperSize[] = ['tiny', 'base', 'small'];

export function packSize(pack: ModelPack) {
  return pack.files.reduce((a, f) => a + f.size, 0);
}

export async function modelPath(file: string) {
  const p = await getPaths();
  return `${p.models}/${file}`;
}

export async function isPackInstalled(pack: ModelPack): Promise<boolean> {
  for (const f of pack.files) {
    const size = await Resona.fileSize(await modelPath(f.file));
    if (size <= 0) return false;
  }
  return true;
}

export async function startPackDownload(pack: ModelPack) {
  for (const f of pack.files) {
    const dest = await modelPath(f.file);
    if ((await Resona.fileSize(dest)) > 0) continue;
    await Resona.download(`${pack.id}:${f.key}`, f.url, dest);
  }
}

export type PackProgress = { installed: boolean; downloading: boolean; bytes: number; total: number; error: string | null };

export async function packProgress(pack: ModelPack): Promise<PackProgress> {
  let bytes = 0;
  let downloading = false;
  let installed = true;
  let error: string | null = null;
  for (const f of pack.files) {
    const size = await Resona.fileSize(await modelPath(f.file));
    if (size > 0) {
      bytes += f.size;
      continue;
    }
    installed = false;
    const st = await Resona.getDownloadState(`${pack.id}:${f.key}`);
    if (st) {
      if (st.error) error = st.error;
      else if (!st.done) downloading = true;
      bytes += st.bytes;
    }
  }
  return { installed, downloading, bytes, total: packSize(pack), error };
}

export async function deletePack(pack: ModelPack) {
  for (const f of pack.files) await Resona.deletePath(await modelPath(f.file));
}

import { getPaths, Resona } from './native';
import { DIARIZATION_PACK, isPackInstalled, modelPath, whisperPack, WhisperSize } from './models';

export type Segment = { start: number; end: number; speaker: number; text: string };

export type RecordingStatus = 'recording' | 'recorded' | 'processing' | 'done' | 'error';

export type Recording = {
  id: string;
  title: string;
  createdAt: number;
  duration: number;
  status: RecordingStatus;
  error?: string | null;
  speakers: Record<string, string>; // index de voix -> nom donné par l'utilisateur
  segments?: Segment[];
  transcribed?: boolean;
  engine?: 'local' | 'remote';
};

export type Settings = {
  engine: 'local' | 'remote';
  whisper: WhisperSize | 'none';
  language: 'fr' | 'en' | 'auto';
  numSpeakers: number; // 0 = détection automatique
  sensitivity: 'fewer' | 'normal' | 'more';
  remoteUrl: string;
  remoteKey: string;
};

export const DEFAULT_SETTINGS: Settings = {
  engine: 'local',
  whisper: 'base',
  language: 'fr',
  numSpeakers: 0,
  sensitivity: 'normal',
  remoteUrl: '',
  remoteKey: '',
};

// Seuils de clustering validés sur des tests (empreintes TitaNet) : plus haut = moins de voix distinctes.
const THRESHOLDS: Record<Settings['sensitivity'], number> = { fewer: 0.75, normal: 0.6, more: 0.45 };

// ---------- Chemins ----------

export async function recDir(id: string) {
  return `${(await getPaths()).recordings}/${id}`;
}
export async function wavPath(id: string) {
  return `${await recDir(id)}/audio.wav`;
}
async function metaPath(id: string) {
  return `${await recDir(id)}/meta.json`;
}
async function resultPath(id: string) {
  return `${await recDir(id)}/result.json`;
}

// ---------- Réglages ----------

export async function loadSettings(): Promise<Settings> {
  const raw = await Resona.readText(`${(await getPaths()).base}/settings.json`);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(s: Settings) {
  await Resona.writeText(`${(await getPaths()).base}/settings.json`, JSON.stringify(s));
}

// ---------- Enregistrements ----------

export function speakerName(rec: Recording, speaker: number) {
  return rec.speakers[String(speaker)] || `Voix ${String.fromCharCode(65 + (speaker % 26))}${speaker >= 26 ? Math.floor(speaker / 26) : ''}`;
}

export async function saveRecording(rec: Recording) {
  await Resona.writeText(await metaPath(rec.id), JSON.stringify(rec));
}

export async function loadRecording(id: string): Promise<Recording | null> {
  const raw = await Resona.readText(await metaPath(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function deleteRecording(id: string) {
  await Resona.deletePath(await recDir(id));
}

/** Charge la liste et répare les états incohérents (application tuée pendant un enregistrement ou une analyse). */
export async function listRecordings(): Promise<Recording[]> {
  const paths = await getPaths();
  const ids = await Resona.listDirs(paths.recordings);
  const rec = await Resona.getRecorderState();
  const proc = await Resona.getProcessingState();
  const out: Recording[] = [];
  for (const id of ids) {
    const r = await loadRecording(id);
    if (!r) continue;
    if (r.status === 'recording' && !(rec.active && rec.id === id)) {
      await Resona.repairWav(await wavPath(id));
      r.duration = await Resona.wavDuration(await wavPath(id));
      r.status = 'recorded';
      await saveRecording(r);
    }
    if (r.status === 'processing' && r.engine !== 'remote' && !(proc.running && proc.id === id)) {
      await syncProcessingResult(r);
    }
    out.push(r);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export function newRecordingId() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function defaultTitle(ts: number) {
  const d = new Date(ts);
  const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Réunion du ${days[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)} à ${pad(d.getHours())}h${pad(d.getMinutes())}`;
}

export async function startNewRecording(): Promise<Recording> {
  const id = newRecordingId();
  const now = Date.now();
  const rec: Recording = { id, title: defaultTitle(now), createdAt: now, duration: 0, status: 'recording', speakers: {} };
  await saveRecording(rec);
  await Resona.startRecording(id, await wavPath(id));
  return rec;
}

export async function finishRecording(id: string): Promise<Recording | null> {
  await Resona.stopRecording();
  const r = await loadRecording(id);
  if (!r) return null;
  r.duration = await Resona.wavDuration(await wavPath(id));
  r.status = 'recorded';
  await saveRecording(r);
  return r;
}

// ---------- Analyse ----------

/** Intègre le résultat d'une analyse locale terminée (ou marque l'échec). */
export async function syncProcessingResult(r: Recording): Promise<Recording> {
  // result.json est supprimé au lancement et n'est écrit qu'en cas de succès.
  const raw = await Resona.readText(await resultPath(r.id));
  const proc = await Resona.getProcessingState();
  if (raw) {
    applyResult(r, JSON.parse(raw), 'local');
  } else {
    r.status = 'error';
    r.error = proc.id === r.id && proc.error ? proc.error : 'Analyse interrompue';
  }
  await saveRecording(r);
  return r;
}

function applyResult(r: Recording, result: any, engine: 'local' | 'remote') {
  r.segments = result.segments;
  r.transcribed = !!result.transcribed;
  r.engine = engine;
  r.status = 'done';
  r.error = null;
  // conserve les noms existants s'ils sont encore valides
  const kept: Record<string, string> = {};
  for (const s of r.segments ?? []) {
    const k = String(s.speaker);
    if (r.speakers[k]) kept[k] = r.speakers[k];
  }
  r.speakers = kept;
}

export class MissingModelsError extends Error {}

export async function startLocalProcessing(r: Recording, s: Settings) {
  if (!(await isPackInstalled(DIARIZATION_PACK))) {
    throw new MissingModelsError('Le modèle de reconnaissance des voix doit d\'abord être téléchargé (Réglages).');
  }
  let whisper: { enc: string; dec: string; tok: string } | null = null;
  if (s.whisper !== 'none') {
    const pack = whisperPack(s.whisper);
    if (!(await isPackInstalled(pack))) {
      throw new MissingModelsError(`Le modèle de transcription ${pack.label} doit d'abord être téléchargé (Réglages).`);
    }
    whisper = {
      enc: await modelPath(pack.files[0].file),
      dec: await modelPath(pack.files[1].file),
      tok: await modelPath(pack.files[2].file),
    };
  }
  const paths = await getPaths();
  await Resona.deletePath(await resultPath(r.id));
  await Resona.startProcessing({
    id: r.id,
    wavPath: await wavPath(r.id),
    outPath: await resultPath(r.id),
    segmentationModel: await modelPath(DIARIZATION_PACK.files[0].file),
    embeddingModel: await modelPath(DIARIZATION_PACK.files[1].file),
    whisperEncoder: whisper?.enc ?? null,
    whisperDecoder: whisper?.dec ?? null,
    whisperTokens: whisper?.tok ?? null,
    language: s.language === 'auto' ? '' : s.language,
    numSpeakers: s.numSpeakers,
    threshold: THRESHOLDS[s.sensitivity],
    threads: Math.max(1, Math.min(4, paths.cpuCount - 1)),
  });
  r.status = 'processing';
  r.engine = 'local';
  r.error = null;
  await saveRecording(r);
}

/**
 * Analyse sur un serveur externe (optionnelle). Contrat attendu :
 *   POST <url>  (multipart/form-data : audio=<fichier wav>, language, num_speakers)
 *   En-tête Authorization: Bearer <clé> si une clé est renseignée.
 *   Réponse JSON : { "segments": [ { "start": 0.0, "end": 3.2, "speaker": "SPEAKER_00", "text": "..." } ] }
 */
export async function runRemoteProcessing(r: Recording, s: Settings): Promise<Recording> {
  if (!s.remoteUrl) throw new Error('Aucune adresse de serveur configurée (Réglages).');
  r.status = 'processing';
  r.engine = 'remote';
  r.error = null;
  await saveRecording(r);
  try {
    const form = new FormData();
    form.append('audio', { uri: `file://${await wavPath(r.id)}`, type: 'audio/wav', name: `${r.id}.wav` } as any);
    form.append('language', s.language);
    form.append('num_speakers', String(s.numSpeakers));
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (s.remoteKey) headers.Authorization = `Bearer ${s.remoteKey}`;
    const res = await fetch(s.remoteUrl, { method: 'POST', body: form, headers });
    if (!res.ok) throw new Error(`Serveur : HTTP ${res.status}`);
    const json = await res.json();
    const order = new Map<string, number>();
    const segments: Segment[] = (json.segments ?? []).map((seg: any) => {
      const key = String(seg.speaker ?? 0);
      if (!order.has(key)) order.set(key, order.size);
      return { start: Number(seg.start) || 0, end: Number(seg.end) || 0, speaker: order.get(key)!, text: String(seg.text ?? '').trim() };
    });
    applyResult(r, { segments, transcribed: segments.some(x => x.text) }, 'remote');
  } catch (e: any) {
    r.status = 'error';
    r.error = e?.message ?? String(e);
  }
  await saveRecording(r);
  return r;
}

// ---------- Export ----------

export function formatTime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function transcriptText(r: Recording) {
  const lines = [r.title, ''];
  for (const s of r.segments ?? []) {
    lines.push(`[${formatTime(s.start)}] ${speakerName(r, s.speaker)} : ${s.text || '…'}`);
  }
  return lines.join('\n');
}

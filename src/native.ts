import { NativeModules } from 'react-native';

export type RecorderState = {
  active: boolean;
  paused: boolean;
  id: string | null;
  elapsedSec: number;
  level: number;
  error: string | null;
};

export type ProcessingState = {
  running: boolean;
  id: string | null;
  stage: string;
  progress: number;
  error: string | null;
  finishedId: string | null;
};

export type DownloadState = { bytes: number; total: number; done: boolean; error: string | null };

export type PlayerState = { loaded: boolean; playing: boolean; position: number; duration: number; ranges?: boolean; speed?: number };

export type Paths = { base: string; recordings: string; models: string; exports: string; cpuCount: number; sdk: number };

export type ProcessingOptions = {
  id: string;
  wavPath: string;
  outPath: string;
  segmentationModel: string;
  embeddingModel: string;
  whisperEncoder?: string | null;
  whisperDecoder?: string | null;
  whisperTokens?: string | null;
  language: string;
  numSpeakers: number;
  threshold: number;
  threads: number;
};

type ResonaNative = {
  getPaths(): Promise<Paths>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, content: string): Promise<boolean>;
  exists(path: string): Promise<boolean>;
  fileSize(path: string): Promise<number>;
  deletePath(path: string): Promise<boolean>;
  listDirs(path: string): Promise<string[]>;
  wavDuration(path: string): Promise<number>;
  repairWav(path: string): Promise<boolean>;

  startRecording(id: string, path: string): Promise<boolean>;
  pauseRecording(): Promise<boolean>;
  resumeRecording(): Promise<boolean>;
  stopRecording(): Promise<number>;
  getRecorderState(): Promise<RecorderState>;

  download(key: string, url: string, dest: string): Promise<boolean>;
  getDownloadState(key: string): Promise<DownloadState | null>;

  startProcessing(opts: ProcessingOptions): Promise<boolean>;
  getProcessingState(): Promise<ProcessingState>;
  cancelProcessing(): Promise<boolean>;

  playerLoad(path: string): Promise<number>;
  playerPlay(): Promise<boolean>;
  playerPause(): Promise<boolean>;
  playerSeek(sec: number): Promise<boolean>;
  playerState(): Promise<PlayerState>;
  playerRelease(): Promise<boolean>;
  playerSetSpeed(speed: number): Promise<boolean>;
  playerPlayRanges(ranges: [number, number][]): Promise<boolean>;
  playerClearRanges(): Promise<boolean>;

  exportAudio(wavPath: string, outPath: string, ranges: [number, number][] | null): Promise<string>;
  shareFiles(paths: string[], mime: string, title: string): Promise<boolean>;
  saveToDownloads(path: string, displayName: string, mime: string): Promise<string>;
  haptic(kind: 'tap' | 'select' | 'success' | 'heavy'): void;
};

export const Resona: ResonaNative = NativeModules.Resona;

let pathsCache: Paths | null = null;
export async function getPaths(): Promise<Paths> {
  if (!pathsCache) pathsCache = await Resona.getPaths();
  return pathsCache;
}

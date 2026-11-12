import { useEffect, useRef } from 'react';

export const C = {
  bg: '#0E0F14',
  card: '#181A22',
  cardHi: '#20232E',
  border: '#2A2E3B',
  text: '#F2F3F7',
  sub: '#9AA0B2',
  dim: '#636A7E',
  accent: '#7C6CFF',
  accentSoft: '#7C6CFF33',
  rec: '#FF4D5E',
  ok: '#3DD68C',
  warn: '#FFB547',
};

/** Couleurs des voix : A, B, C… */
export const SPEAKER_COLORS = ['#7C6CFF', '#3DD6C4', '#FFB547', '#FF6B9A', '#5AB0FF', '#A6E05A', '#FF8A4C', '#C77DFF', '#4CE0FF', '#FFD84C'];

export function speakerColor(i: number) {
  return SPEAKER_COLORS[i % SPEAKER_COLORS.length];
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms == null) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(n > 100 * 1024 * 1024 ? 0 : 1)} Mo`;
}

import { useEffect, useRef } from 'react';
import { useColorScheme } from 'react-native';

/**
 * Système de design de Resona.
 * Inspiré des couleurs système d'Apple (clair / sombre suivant le téléphone).
 */
export type Palette = {
  dark: boolean;
  bg: string; // fond de page
  card: string; // surfaces groupées
  card2: string; // surfaces secondaires / champs
  fill: string; // fonds de contrôles
  label: string;
  label2: string;
  label3: string;
  separator: string;
  accent: string;
  accentSoft: string;
  red: string;
  green: string;
  orange: string;
  overlay: string;
};

const LIGHT: Palette = {
  dark: false,
  bg: '#F2F2F7',
  card: '#FFFFFF',
  card2: '#F2F2F7',
  fill: 'rgba(118,118,128,0.12)',
  label: '#000000',
  label2: 'rgba(60,60,67,0.6)',
  label3: 'rgba(60,60,67,0.3)',
  separator: 'rgba(60,60,67,0.18)',
  accent: '#5856D6',
  accentSoft: 'rgba(88,86,214,0.12)',
  red: '#FF3B30',
  green: '#34C759',
  orange: '#FF9500',
  overlay: 'rgba(0,0,0,0.35)',
};

const DARK: Palette = {
  dark: true,
  bg: '#000000',
  card: '#1C1C1E',
  card2: '#2C2C2E',
  fill: 'rgba(118,118,128,0.24)',
  label: '#FFFFFF',
  label2: 'rgba(235,235,245,0.6)',
  label3: 'rgba(235,235,245,0.3)',
  separator: 'rgba(84,84,88,0.6)',
  accent: '#7D7AFF',
  accentSoft: 'rgba(125,122,255,0.18)',
  red: '#FF453A',
  green: '#30D158',
  orange: '#FF9F0A',
  overlay: 'rgba(0,0,0,0.55)',
};

export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}

/** Échelle typographique (tailles iOS). */
export const type = {
  largeTitle: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.2 },
  title1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: 0.2 },
  title2: { fontSize: 22, fontWeight: '700' as const },
  title3: { fontSize: 20, fontWeight: '600' as const },
  headline: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 17, fontWeight: '400' as const },
  callout: { fontSize: 16, fontWeight: '400' as const },
  subhead: { fontSize: 15, fontWeight: '400' as const },
  footnote: { fontSize: 13, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
};

/** Couleurs des personnes (couleurs système Apple). */
const SPEAKERS_LIGHT = ['#007AFF', '#FF9500', '#34C759', '#FF2D55', '#AF52DE', '#30B0C7', '#E6B800', '#5856D6', '#00C7BE', '#A2845E'];
const SPEAKERS_DARK = ['#0A84FF', '#FF9F0A', '#30D158', '#FF375F', '#BF5AF2', '#40C8E0', '#FFD60A', '#5E5CE6', '#63E6E2', '#AC8E68'];

export function speakerColor(i: number, dark = true) {
  const list = dark ? SPEAKERS_DARK : SPEAKERS_LIGHT;
  return list[((i % list.length) + list.length) % list.length];
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

export function withAlpha(hex: string, alpha: number) {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return `${hex}${a}`;
}

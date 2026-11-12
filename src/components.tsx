import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { C } from './theme';

export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={s.header}>
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} style={s.backBtn}>
          <Text style={s.backTxt}>‹</Text>
        </Pressable>
      ) : null}
      <Text style={[s.headerTitle, !onBack && { marginLeft: 4 }]} numberOfLines={1}>
        {title}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>{right}</View>
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const bg = kind === 'primary' ? C.accent : kind === 'danger' ? '#FF4D5E22' : C.cardHi;
  const fg = kind === 'danger' ? C.rec : kind === 'primary' ? '#fff' : C.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 }, style]}>
      <Text style={[s.btnTxt, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, color, active, onPress }: { label: string; color?: string; active?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[s.chip, active && { backgroundColor: C.accentSoft, borderColor: C.accent }, color ? { borderColor: color } : null]}>
      {color ? <View style={[s.dot, { backgroundColor: color }]} /> : null}
      <Text style={[s.chipTxt, active && { color: C.text }]}>{label}</Text>
    </Pressable>
  );
}

export function ProgressBar({ value, color = C.accent }: { value: number; color?: string }) {
  return (
    <View style={s.pbTrack}>
      <View style={[s.pbFill, { width: `${Math.max(0, Math.min(1, value)) * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

/** Icônes dessinées en pur React Native (pas de dépendance). */
export function PlayIcon({ size = 18, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <View
      style={{
        width: 0,
        height: 0,
        marginLeft: size * 0.2,
        borderTopWidth: size / 2,
        borderBottomWidth: size / 2,
        borderLeftWidth: size * 0.85,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        borderLeftColor: color,
      }}
    />
  );
}

export function PauseIcon({ size = 18, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: size * 0.25 }}>
      <View style={{ width: size * 0.3, height: size, backgroundColor: color, borderRadius: 2 }} />
      <View style={{ width: size * 0.3, height: size, backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

export function StopIcon({ size = 18, color = '#fff' }: { size?: number; color?: string }) {
  return <View style={{ width: size, height: size, backgroundColor: color, borderRadius: 4 }} />;
}

export const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  backTxt: { color: C.text, fontSize: 28, lineHeight: 30, marginTop: -3 },
  headerTitle: { flex: 1, color: C.text, fontSize: 22, fontWeight: '700' },
  btn: { paddingVertical: 13, paddingHorizontal: 18, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  btnTxt: { fontSize: 15, fontWeight: '600' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    gap: 6,
  },
  chipTxt: { color: C.sub, fontSize: 13, fontWeight: '600' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  pbTrack: { height: 6, borderRadius: 3, backgroundColor: C.border, overflow: 'hidden' },
  pbFill: { height: 6, borderRadius: 3 },
});

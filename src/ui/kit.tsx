import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  TextProps,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Resona } from '../native';
import { Palette, type, useTheme } from '../theme';
import { Icon, IconName } from './Icon';

export const haptic = (kind: 'tap' | 'select' | 'success' | 'heavy' = 'tap') => {
  try {
    Resona.haptic(kind);
  } catch {}
};

// ---------- Texte ----------

export function T({
  v = 'body',
  c,
  style,
  ...rest
}: TextProps & { v?: keyof typeof type; c?: string }) {
  const t = useTheme();
  return <Text {...rest} style={[type[v], { color: c ?? t.label }, style]} />;
}

// ---------- Pression animée ----------

/** Pressable avec léger enfoncement animé (ressort), comme sur iOS. */
export function Tap({
  children,
  style,
  scale = 0.97,
  hapticKind,
  onPress,
  disabled,
  ...rest
}: PressableProps & { style?: StyleProp<ViewStyle>; scale?: number; hapticKind?: 'tap' | 'select' | 'success' | 'heavy' | null; children?: React.ReactNode }) {
  const a = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.spring(a, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  // Les propriétés de placement (flex, marges, alignSelf) vont sur le Pressable extérieur,
  // le reste (fond, taille, bordures) sur la vue animée.
  const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle;
  const { flex, alignSelf, margin, marginTop, marginBottom, marginLeft, marginRight, marginHorizontal, marginVertical, ...inner } = flat;
  const outer: ViewStyle = { flex, alignSelf, margin, marginTop, marginBottom, marginLeft, marginRight, marginHorizontal, marginVertical };
  if (flex != null) inner.flexGrow = 1;
  return (
    <Pressable
      {...rest}
      style={outer}
      disabled={disabled}
      onPressIn={() => to(scale)}
      onPressOut={() => to(1)}
      onPress={e => {
        if (hapticKind !== null) haptic(hapticKind ?? 'tap');
        onPress?.(e);
      }}>
      <Animated.View style={[inner, { transform: [{ scale: a }], opacity: disabled ? 0.4 : 1 }]}>{children}</Animated.View>
    </Pressable>
  );
}

// ---------- Boutons ----------

export function Button({
  label,
  icon,
  onPress,
  kind = 'filled',
  color,
  disabled,
  style,
  small,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
  kind?: 'filled' | 'tinted' | 'plain' | 'gray';
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const t = useTheme();
  const c = color ?? t.accent;
  const bg = kind === 'filled' ? c : kind === 'tinted' ? c + '24' : kind === 'gray' ? t.fill : 'transparent';
  const fg = kind === 'filled' ? '#fff' : kind === 'gray' ? t.label : c;
  return (
    <Tap onPress={onPress} disabled={disabled} style={[{ backgroundColor: bg, borderRadius: small ? 10 : 14, paddingVertical: small ? 8 : 14, paddingHorizontal: small ? 12 : 18 }, s.row, s.center, style]}>
      {icon ? <Icon name={icon} size={small ? 16 : 19} color={fg} /> : null}
      <T v={small ? 'subhead' : 'headline'} c={fg} style={{ fontWeight: '600', marginLeft: icon ? 7 : 0 }}>
        {label}
      </T>
    </Tap>
  );
}

export function IconButton({ name, onPress, color, bg, size = 36, iconSize = 20, hapticKind }: { name: IconName; onPress: () => void; color?: string; bg?: string; size?: number; iconSize?: number; hapticKind?: 'tap' | 'select' }) {
  const t = useTheme();
  return (
    <Tap onPress={onPress} hitSlop={8} scale={0.9} hapticKind={hapticKind} style={[s.center, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg ?? t.fill }]}>
      <Icon name={name} size={iconSize} color={color ?? t.accent} />
    </Tap>
  );
}

// ---------- Barre de navigation ----------

export function NavBar({ backLabel, onBack, title, right }: { backLabel?: string; onBack?: () => void; title?: string; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={[s.row, { height: 48, paddingHorizontal: 8, alignItems: 'center' }]}>
      <View style={{ flex: 1, alignItems: 'flex-start' }}>
        {onBack ? (
          <Tap onPress={onBack} scale={0.94} style={[s.row, { alignItems: 'center', paddingHorizontal: 6, paddingVertical: 6 }]} hitSlop={10}>
            <Icon name="chevronLeft" size={22} color={t.accent} />
            <T v="body" c={t.accent} style={{ marginLeft: 2 }} numberOfLines={1}>
              {backLabel ?? 'Retour'}
            </T>
          </Tap>
        ) : null}
      </View>
      {title ? (
        <T v="headline" numberOfLines={1} style={{ flex: 2, textAlign: 'center' }}>
          {title}
        </T>
      ) : null}
      <View style={[s.row, { flex: 1, justifyContent: 'flex-end', gap: 10, paddingRight: 8 }]}>{right}</View>
    </View>
  );
}

// ---------- Listes groupées ----------

export function Group({ header, footer, children, style }: { header?: string; footer?: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={style}>
      {header ? (
        <T v="footnote" c={t.label2} style={{ textTransform: 'uppercase', marginLeft: 16, marginBottom: 7, letterSpacing: 0.3 }}>
          {header}
        </T>
      ) : null}
      <View style={{ backgroundColor: t.card, borderRadius: 12, overflow: 'hidden' }}>
        {items.map((c, i) => (
          <View key={i}>
            {c}
            {i < items.length - 1 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.separator, marginLeft: 16 }} /> : null}
          </View>
        ))}
      </View>
      {footer ? (
        <T v="footnote" c={t.label2} style={{ marginHorizontal: 16, marginTop: 7, lineHeight: 18 }}>
          {footer}
        </T>
      ) : null}
    </View>
  );
}

export function Row({
  title,
  subtitle,
  icon,
  iconBg,
  right,
  onPress,
  chevron,
  destructive,
  checked,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  iconBg?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  checked?: boolean;
}) {
  const t = useTheme();
  const content = (
    <View style={[s.row, { alignItems: 'center', paddingHorizontal: 16, minHeight: 50, paddingVertical: 10, gap: 12 }]}>
      {icon ? (
        <View style={[s.center, { width: 30, height: 30, borderRadius: 7, backgroundColor: iconBg ?? t.accent }]}>
          <Icon name={icon} size={18} color="#fff" />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <T v="body" c={destructive ? t.red : t.label}>
          {title}
        </T>
        {subtitle ? (
          <T v="footnote" c={t.label2} style={{ marginTop: 2 }}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right}
      {checked ? <Icon name="check" size={18} color={t.accent} /> : null}
      {chevron ? <Icon name="chevronRight" size={15} color={t.label3} /> : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={() => { haptic('select'); onPress(); }} android_ripple={{ color: t.fill }}>
      {content}
    </Pressable>
  );
}

// ---------- Contrôle segmenté ----------

export function Segmented<K extends string>({ items, value, onChange, style }: { items: { key: K; label: string }[]; value: K; onChange: (k: K) => void; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const idx = Math.max(0, items.findIndex(i => i.key === value));
  const x = useRef(new Animated.Value(idx)).current;
  useEffect(() => {
    Animated.spring(x, { toValue: idx, useNativeDriver: true, speed: 18, bounciness: 4 }).start();
  }, [idx, x]);
  const segW = w ? (w - 4) / items.length : 0;
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={[{ backgroundColor: t.fill, borderRadius: 9, padding: 2, flexDirection: 'row' }, style]}>
      {segW ? (
        <Animated.View
          style={{
            position: 'absolute',
            top: 2,
            bottom: 2,
            left: 2,
            width: segW,
            borderRadius: 7,
            backgroundColor: t.dark ? '#636366' : '#FFFFFF',
            elevation: 2,
            transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, segW] }) }],
          }}
        />
      ) : null}
      {items.map(i => (
        <Pressable
          key={i.key}
          onPress={() => {
            if (i.key !== value) haptic('select');
            onChange(i.key);
          }}
          style={{ flex: 1, paddingVertical: 7, alignItems: 'center' }}>
          <T v="subhead" numberOfLines={1} style={{ fontWeight: i.key === value ? '600' : '500' }}>
            {i.label}
          </T>
        </Pressable>
      ))}
    </View>
  );
}

// ---------- Avatar ----------

export function Avatar({ name, color, size = 40 }: { name: string; color: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join('');
  return (
    <View style={[s.center, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.38 }}>{initials || '?'}</Text>
    </View>
  );
}

// ---------- Feuille du bas ----------

/** Feuille qui glisse depuis le bas (fermeture par glissement, toucher du fond ou retour). */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const y = useRef(new Animated.Value(800)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const wasVisible = useRef(false);

  useEffect(() => {
    if (visible && !wasVisible.current) {
      wasVisible.current = true;
      setMounted(true);
      y.setValue(800);
      fade.setValue(0);
      Animated.parallel([
        Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 220, mass: 0.9 }),
        Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
    } else if (!visible && wasVisible.current) {
      wasVisible.current = false;
      Animated.parallel([
        Animated.timing(y, { toValue: 800, duration: 220, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished && !wasVisible.current) setMounted(false);
      });
    }
  }, [visible, y, fade]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > 120 || g.vy > 1.2) onClose();
          else Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 240 }).start();
        },
      }),
    [y, onClose],
  );

  if (!mounted) return null;
  return (
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.overlay, opacity: fade }]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={{
            backgroundColor: t.dark ? '#0F0F11' : '#F2F2F7',
            borderTopLeftRadius: 14,
            borderTopRightRadius: 14,
            paddingBottom: insets.bottom + 16,
            maxHeight: '92%',
            transform: [{ translateY: y }],
          }}>
          <View {...pan.panHandlers} style={{ alignItems: 'center', paddingTop: 8, paddingBottom: title ? 4 : 10 }}>
            <View style={{ width: 38, height: 5, borderRadius: 3, backgroundColor: t.label3 }} />
            {title ? (
              <T v="headline" style={{ marginTop: 14, marginBottom: 6 }}>
                {title}
              </T>
            ) : null}
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- Toast ----------

type ToastFn = (msg: string, icon?: IconName) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<{ text: string; icon?: IconName } | null>(null);
  const a = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback<ToastFn>(
    (text, icon) => {
      setMsg({ text, icon });
      if (timer.current) clearTimeout(timer.current);
      Animated.spring(a, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 200 }).start();
      timer.current = setTimeout(() => {
        Animated.timing(a, { toValue: 0, duration: 250, useNativeDriver: true }).start(() => setMsg(null));
      }, 2600);
    },
    [a],
  );
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: insets.top + 8,
            alignSelf: 'center',
            maxWidth: '88%',
            opacity: a,
            transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }, { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }],
          }}>
          <View style={[s.row, { alignItems: 'center', gap: 10, backgroundColor: t.dark ? '#2C2C2E' : '#FFFFFF', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 26, elevation: 8 }]}>
            {msg.icon ? <Icon name={msg.icon} size={18} color={t.green} /> : null}
            <T v="subhead" style={{ fontWeight: '600' }}>
              {msg.text}
            </T>
          </View>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}

// ---------- Apparition douce ----------

export function FadeIn({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 320, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [a, delay]);
  return (
    <Animated.View style={[style, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>{children}</Animated.View>
  );
}

export function useStyles<T>(fn: (t: Palette) => T): T {
  const t = useTheme();
  return useMemo(() => fn(t), [t, fn]);
}

export const s = StyleSheet.create({
  row: { flexDirection: 'row' },
  center: { alignItems: 'center', justifyContent: 'center' },
});

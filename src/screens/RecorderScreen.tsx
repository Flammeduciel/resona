import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, Easing, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RecorderState, Resona } from '../native';
import { finishRecording, formatTime, loadRecording, Recording, saveRecording } from '../store';
import { useInterval, useTheme } from '../theme';
import { Icon } from '../ui/Icon';
import { haptic, NavBar, s, T, Tap } from '../ui/kit';

const BARS = 64;

export function RecorderScreen({ id, onDone, onBack }: { id: string; onDone: (id: string) => void; onBack: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<RecorderState | null>(null);
  const [rec, setRec] = useState<Recording | null>(null);
  const [levels, setLevels] = useState<number[]>(() => new Array(BARS).fill(0));
  const stopping = useRef(false);
  const dot = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    loadRecording(id).then(setRec);
  }, [id]);

  const paused = !!state?.paused;
  const active = state?.active ?? true;

  useEffect(() => {
    if (paused || !active) {
      dot.setValue(0.35);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dot, { toValue: 0.25, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(dot, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [paused, active, dot]);

  useInterval(async () => {
    const st = await Resona.getRecorderState();
    setState(st);
    if (st.error && !stopping.current) {
      stopping.current = true;
      Alert.alert('Erreur d\'enregistrement', st.error);
    }
    const v = st.paused ? 0 : Math.min(1, Math.sqrt(st.level) * 2.4);
    setLevels(l => [...l.slice(1), v]);
  }, 90);

  const stop = async () => {
    if (stopping.current) return;
    stopping.current = true;
    haptic('success');
    await finishRecording(id);
    onDone(id);
  };

  const togglePause = async () => {
    haptic('select');
    if (paused) await Resona.resumeRecording();
    else await Resona.pauseRecording();
  };

  const saveTitle = async (title: string) => {
    const fresh = (await loadRecording(id)) ?? rec;
    if (!fresh) return;
    fresh.title = title.trim() || fresh.title;
    await saveRecording(fresh);
    setRec(fresh);
  };

  const elapsed = state?.elapsedSec ?? 0;
  const mm = Math.floor(elapsed / 60);
  const ss = Math.floor(elapsed % 60);
  const cs = Math.floor((elapsed % 1) * 10);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <NavBar backLabel="Réunions" onBack={onBack} />
      <View style={{ paddingHorizontal: 24, marginTop: 6 }}>
        {rec ? (
          <TextInput
            defaultValue={rec.title}
            onEndEditing={e => saveTitle(e.nativeEvent.text)}
            style={[st.title, { color: t.label }]}
            selectionColor={t.accent}
            multiline
            submitBehavior="blurAndSubmit"
            returnKeyType="done"
          />
        ) : null}
        <View style={[s.row, { alignItems: 'center', gap: 8, marginTop: 6 }]}>
          <Animated.View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: paused ? t.label3 : t.red, opacity: dot }} />
          <T v="subhead" c={t.label2}>
            {!active ? 'Arrêté' : paused ? 'En pause' : 'Enregistrement'}
          </T>
        </View>
      </View>

      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <View style={[s.row, { alignItems: 'baseline' }]}>
          <T style={[st.timer, { color: t.label }]}>
            {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
          </T>
          <T style={[st.timerSmall, { color: t.label2 }]}>,{cs}</T>
        </View>
        <View style={[s.row, { alignItems: 'center', height: 150, gap: 3, marginTop: 34 }]}>
          {levels.map((v, i) => (
            <View
              key={i}
              style={{
                width: 3,
                height: 4 + v * 140,
                borderRadius: 2,
                backgroundColor: paused ? t.label3 : t.red,
                opacity: 0.25 + 0.75 * (i / BARS),
              }}
            />
          ))}
        </View>
        <T v="footnote" c={t.label2} style={{ textAlign: 'center', marginTop: 34, paddingHorizontal: 40, lineHeight: 18 }}>
          Vous pouvez verrouiller le téléphone, l'enregistrement continue. La notification permet aussi de le mettre en pause.
        </T>
      </View>

      <View style={[s.row, { alignItems: 'center', justifyContent: 'center', gap: 46, paddingBottom: insets.bottom + 40 }]}>
        <Tap onPress={togglePause} scale={0.9} hapticKind={null} disabled={!active} style={[s.center, { width: 58, height: 58, borderRadius: 29, backgroundColor: t.fill }]}>
          <Icon name={paused ? 'play' : 'pause'} size={24} color={t.label} />
        </Tap>
        <Tap onPress={stop} scale={0.9} hapticKind={null} style={[s.center, { width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: t.dark ? '#5A5A5E' : '#C7C7CC' }]}>
          <View style={{ width: 30, height: 30, borderRadius: 7, backgroundColor: t.red }} />
        </Tap>
        <View style={{ width: 58 }}>
          <T v="caption" c={t.label2} style={{ textAlign: 'center' }}>
            {formatTime(elapsed)}
          </T>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', paddingVertical: 4, paddingHorizontal: 0 },
  timer: { fontSize: 76, fontWeight: '200', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  timerSmall: { fontSize: 40, fontWeight: '200', fontVariant: ['tabular-nums'] },
});

import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Header, PauseIcon, PlayIcon, StopIcon } from '../components';
import { Resona, RecorderState } from '../native';
import { finishRecording, formatTime, loadRecording, Recording, saveRecording } from '../store';
import { C, useInterval } from '../theme';

const BARS = 48;

export function RecorderScreen({ id, onDone, onBack }: { id: string; onDone: (id: string) => void; onBack: () => void }) {
  const [state, setState] = useState<RecorderState | null>(null);
  const [rec, setRec] = useState<Recording | null>(null);
  const [levels, setLevels] = useState<number[]>(() => new Array(BARS).fill(0));
  const stopping = useRef(false);

  useEffect(() => {
    loadRecording(id).then(setRec);
  }, [id]);

  useInterval(async () => {
    const st = await Resona.getRecorderState();
    setState(st);
    if (st.error && !stopping.current) {
      stopping.current = true;
      Alert.alert('Erreur d\'enregistrement', st.error);
    }
    // Normalisation visuelle : la parole tourne autour de 0.01-0.2 en RMS.
    const v = st.paused ? 0 : Math.min(1, Math.sqrt(st.level) * 2.2);
    setLevels(l => [...l.slice(1), v]);
  }, 120);

  const stop = async () => {
    if (stopping.current) return;
    stopping.current = true;
    const r = await finishRecording(id);
    if (r && r.duration < 2) {
      Alert.alert('Enregistrement très court', 'L\'enregistrement fait moins de 2 secondes.');
    }
    onDone(id);
  };

  const togglePause = async () => {
    if (state?.paused) await Resona.resumeRecording();
    else await Resona.pauseRecording();
  };

  const saveTitle = async (title: string) => {
    if (!rec) return;
    const fresh = (await loadRecording(id)) ?? rec;
    fresh.title = title.trim() || rec.title;
    await saveRecording(fresh);
    setRec(fresh);
  };

  const paused = !!state?.paused;
  const active = state?.active ?? true;

  return (
    <View style={{ flex: 1 }}>
      <Header title="Enregistrement" onBack={onBack} />
      <View style={st.body}>
        {rec ? (
          <TextInput
            defaultValue={rec.title}
            onEndEditing={e => saveTitle(e.nativeEvent.text)}
            style={st.title}
            placeholderTextColor={C.dim}
            selectionColor={C.accent}
          />
        ) : null}

        <View style={st.statusRow}>
          <View style={[st.recDot, { backgroundColor: paused || !active ? C.dim : C.rec }]} />
          <Text style={st.statusTxt}>{!active ? 'Arrêté' : paused ? 'En pause' : 'Enregistrement en cours'}</Text>
        </View>

        <Text style={st.timer}>{formatTime(state?.elapsedSec ?? 0)}</Text>

        <View style={st.meter}>
          {levels.map((v, i) => (
            <View
              key={i}
              style={[st.bar, { height: 6 + v * 110, backgroundColor: paused ? C.dim : i > BARS - 4 ? C.rec : C.accent, opacity: 0.35 + (i / BARS) * 0.65 }]}
            />
          ))}
        </View>

        <Text style={st.hint}>
          Vous pouvez verrouiller le téléphone : l'enregistrement continue. Une notification permet de le mettre en pause ou
          de l'arrêter.
        </Text>
      </View>

      <View style={st.controls}>
        <Pressable onPress={togglePause} style={({ pressed }) => [st.ctrl, pressed && { opacity: 0.7 }]} disabled={!active}>
          {paused ? <PlayIcon size={22} color={C.text} /> : <PauseIcon size={22} color={C.text} />}
          <Text style={st.ctrlTxt}>{paused ? 'Reprendre' : 'Pause'}</Text>
        </Pressable>
        <Pressable onPress={stop} style={({ pressed }) => [st.stop, pressed && { transform: [{ scale: 0.95 }] }]}>
          <StopIcon size={28} />
        </Pressable>
        <View style={st.ctrl}>
          <Text style={[st.ctrlTxt, { marginTop: 0 }]}>Terminer</Text>
          <Text style={[st.ctrlTxt, { color: C.dim, fontSize: 11 }]}>appuyez ■</Text>
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  body: { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 12 },
  title: {
    color: C.text,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    alignSelf: 'stretch',
    paddingVertical: 8,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 36 },
  recDot: { width: 10, height: 10, borderRadius: 5 },
  statusTxt: { color: C.sub, fontWeight: '600' },
  timer: { color: C.text, fontSize: 64, fontWeight: '200', marginTop: 8, fontVariant: ['tabular-nums'] },
  meter: { flexDirection: 'row', alignItems: 'center', height: 130, gap: 3, marginTop: 28 },
  bar: { width: 4, borderRadius: 2 },
  hint: { color: C.dim, textAlign: 'center', marginTop: 36, lineHeight: 20 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingBottom: 48, paddingHorizontal: 24 },
  ctrl: { width: 90, alignItems: 'center', gap: 8 },
  ctrlTxt: { color: C.sub, fontSize: 13, marginTop: 4 },
  stop: { width: 84, height: 84, borderRadius: 42, backgroundColor: C.rec, alignItems: 'center', justifyContent: 'center', elevation: 6 },
});

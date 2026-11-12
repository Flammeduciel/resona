import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, Chip, Header, PauseIcon, PlayIcon, ProgressBar } from '../components';
import { PlayerState, ProcessingState, Resona } from '../native';
import {
  deleteRecording,
  formatTime,
  loadRecording,
  loadSettings,
  MissingModelsError,
  Recording,
  runRemoteProcessing,
  saveRecording,
  Segment,
  speakerName,
  startLocalProcessing,
  syncProcessingResult,
  transcriptText,
  wavPath,
} from '../store';
import { C, speakerColor, useInterval } from '../theme';

export function DetailScreen({ id, onBack, onSettings }: { id: string; onBack: () => void; onSettings: () => void }) {
  const [rec, setRec] = useState<Recording | null>(null);
  const [player, setPlayer] = useState<PlayerState>({ loaded: false, playing: false, position: 0, duration: 0 });
  const [proc, setProc] = useState<ProcessingState | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [follow, setFollow] = useState(true);
  const listRef = useRef<FlatList<Segment>>(null);
  const lastActive = useRef(-1);

  const reload = useCallback(async () => {
    const r = await loadRecording(id);
    setRec(r);
    return r;
  }, [id]);

  useEffect(() => {
    reload();
    (async () => {
      try {
        const d = await Resona.playerLoad(await wavPath(id));
        setPlayer(p => ({ ...p, loaded: true, duration: d }));
      } catch {}
    })();
    return () => {
      Resona.playerRelease();
    };
  }, [id, reload]);

  // Position de lecture
  useInterval(async () => {
    setPlayer(await Resona.playerState());
  }, player.playing ? 250 : null);

  // Suivi de l'analyse locale
  const processing = rec?.status === 'processing' && rec.engine !== 'remote';
  useInterval(async () => {
    const st = await Resona.getProcessingState();
    setProc(st);
    if (!st.running && rec) {
      await syncProcessingResult(rec);
      await reload();
    }
  }, processing ? 700 : null);

  const segments = useMemo(() => rec?.segments ?? [], [rec]);
  const duration = player.duration || rec?.duration || 0;

  const activeIndex = useMemo(() => {
    if (!player.loaded || player.position <= 0) return -1;
    return segments.findIndex(sg => player.position >= sg.start && player.position < sg.end + 0.3);
  }, [segments, player.position, player.loaded]);

  useEffect(() => {
    if (follow && player.playing && activeIndex >= 0 && activeIndex !== lastActive.current) {
      lastActive.current = activeIndex;
      listRef.current?.scrollToIndex({ index: activeIndex, viewPosition: 0.3, animated: true });
    }
  }, [activeIndex, follow, player.playing]);

  const stats = useMemo(() => {
    const m = new Map<number, number>();
    for (const sg of segments) m.set(sg.speaker, (m.get(sg.speaker) ?? 0) + (sg.end - sg.start));
    const total = [...m.values()].reduce((a, b) => a + b, 0) || 1;
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([speaker, t]) => ({ speaker, t, pct: t / total }));
  }, [segments]);

  if (!rec) return <View style={{ flex: 1 }} />;

  const togglePlay = async () => {
    if (player.playing) await Resona.playerPause();
    else await Resona.playerPlay();
    setPlayer(await Resona.playerState());
  };

  const seek = async (sec: number, play = false) => {
    await Resona.playerSeek(Math.max(0, Math.min(duration, sec)));
    if (play) await Resona.playerPlay();
    setPlayer(await Resona.playerState());
  };

  const analyze = async () => {
    const settings = await loadSettings();
    try {
      if (settings.engine === 'remote') {
        setRec({ ...rec, status: 'processing', engine: 'remote' });
        await runRemoteProcessing(rec, settings);
        await reload();
      } else {
        await startLocalProcessing(rec, settings);
        await reload();
      }
    } catch (e: any) {
      if (e instanceof MissingModelsError) {
        Alert.alert('Modèles manquants', e.message, [
          { text: 'Plus tard', style: 'cancel' },
          { text: 'Ouvrir les réglages', onPress: onSettings },
        ]);
      } else {
        Alert.alert('Analyse impossible', e?.message ?? String(e));
        await reload();
      }
    }
  };

  const confirmReanalyze = () =>
    Alert.alert('Relancer l\'analyse ?', 'Les voix seront recalculées (les noms seront conservés si possible).', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Relancer', onPress: analyze },
    ]);

  const remove = () =>
    Alert.alert('Supprimer cette réunion ?', 'L\'audio et la transcription seront définitivement effacés.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          await Resona.playerRelease();
          await deleteRecording(id);
          onBack();
        },
      },
    ]);

  const share = () => Share.share({ message: transcriptText(rec), title: rec.title });

  const renameSpeaker = async (speaker: number, name: string) => {
    const r = { ...rec, speakers: { ...rec.speakers } };
    if (name.trim()) r.speakers[String(speaker)] = name.trim();
    else delete r.speakers[String(speaker)];
    await saveRecording(r);
    setRec(r);
  };

  const mergeSpeaker = async (from: number, into: number) => {
    const merged: Segment[] = [];
    for (const sg of rec.segments ?? []) {
      const cur = sg.speaker === from ? { ...sg, speaker: into } : sg;
      const last = merged[merged.length - 1];
      if (last && last.speaker === cur.speaker && cur.start - last.end < 1.0) {
        merged[merged.length - 1] = { ...last, end: Math.max(last.end, cur.end), text: [last.text, cur.text].filter(Boolean).join(' ') };
      } else merged.push(cur);
    }
    const speakers = { ...rec.speakers };
    delete speakers[String(from)];
    const r = { ...rec, segments: merged, speakers };
    await saveRecording(r);
    setRec(r);
    setEditing(null);
  };

  const saveTitle = async (title: string) => {
    const r = { ...rec, title: title.trim() || rec.title };
    await saveRecording(r);
    setRec(r);
    setEditingTitle(false);
  };

  const ListHeader = (
    <View style={{ gap: 14, paddingBottom: 6 }}>
      {rec.status === 'recorded' || rec.status === 'error' ? (
        <View style={st.card}>
          <Text style={st.cardTitle}>{rec.status === 'error' ? 'L\'analyse a échoué' : 'Prêt à analyser'}</Text>
          <Text style={st.cardText}>
            {rec.status === 'error'
              ? rec.error ?? 'Erreur inconnue'
              : 'Resona va repérer les différentes voix puis transcrire ce que chacun a dit. Tout se fait sur le téléphone.'}
          </Text>
          <Button label={rec.status === 'error' ? 'Réessayer' : 'Analyser la réunion'} onPress={analyze} style={{ marginTop: 14 }} />
        </View>
      ) : null}

      {rec.status === 'processing' ? (
        <View style={st.card}>
          <Text style={st.cardTitle}>{rec.engine === 'remote' ? 'Envoi au serveur…' : proc?.stage || 'Analyse en cours…'}</Text>
          {rec.engine !== 'remote' ? (
            <>
              <View style={{ marginTop: 12 }}>
                <ProgressBar value={proc?.progress ?? 0} />
              </View>
              <Text style={[st.cardText, { marginTop: 8 }]}>
                {Math.round((proc?.progress ?? 0) * 100)} % · vous pouvez quitter l'application, l'analyse continue.
              </Text>
              <Button label="Annuler" kind="ghost" onPress={() => Resona.cancelProcessing()} style={{ marginTop: 12 }} />
            </>
          ) : (
            <Text style={[st.cardText, { marginTop: 8 }]}>Le serveur traite l'audio, merci de patienter.</Text>
          )}
        </View>
      ) : null}

      {rec.status === 'done' ? (
        <View>
          <Text style={st.section}>Participants · touchez pour nommer</Text>
          <View style={st.legend}>
            {stats.map(x => (
              <Pressable key={x.speaker} onPress={() => setEditing(x.speaker)} style={st.person}>
                <View style={[st.avatar, { backgroundColor: speakerColor(x.speaker) + '33', borderColor: speakerColor(x.speaker) }]}>
                  <Text style={[st.avatarTxt, { color: speakerColor(x.speaker) }]}>
                    {speakerName(rec, x.speaker).charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.personName} numberOfLines={1}>
                    {speakerName(rec, x.speaker)}
                  </Text>
                  <Text style={st.personSub}>
                    {Math.round(x.pct * 100)} % du temps de parole · {formatTime(x.t)}
                  </Text>
                </View>
                <Text style={{ color: C.dim, fontSize: 16 }}>✎</Text>
              </Pressable>
            ))}
          </View>
          <View style={st.rowBetween}>
            <Text style={st.section}>Conversation</Text>
            <Pressable onPress={() => setFollow(f => !f)}>
              <Text style={[st.link, !follow && { color: C.dim }]}>{follow ? 'Suivi auto : oui' : 'Suivi auto : non'}</Text>
            </Pressable>
          </View>
          {!rec.transcribed ? (
            <Text style={[st.cardText, { marginBottom: 6 }]}>
              Transcription désactivée : seuls les tours de parole sont affichés. Activez Whisper dans les réglages puis relancez
              l'analyse.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  const ListFooter =
    rec.status === 'done' ? (
      <View style={{ paddingVertical: 24, gap: 10 }}>
        <Button label="Partager la transcription" onPress={share} />
        <Button label="Relancer l'analyse" kind="ghost" onPress={confirmReanalyze} />
      </View>
    ) : undefined;

  return (
    <View style={{ flex: 1 }}>
      <Header
        title=""
        onBack={onBack}
        right={
          <Pressable onPress={remove} hitSlop={10} style={st.iconBtn}>
            <Text style={{ color: C.rec, fontSize: 15, fontWeight: '700' }}>Supprimer</Text>
          </Pressable>
        }
      />
      <Pressable onPress={() => setEditingTitle(true)} style={{ paddingHorizontal: 20 }}>
        <Text style={st.title}>{rec.title}</Text>
        <Text style={st.meta}>
          {new Date(rec.createdAt).toLocaleDateString('fr-FR')} · {formatTime(duration)}
          {rec.engine ? ` · analyse ${rec.engine === 'local' ? 'locale' : 'serveur'}` : ''}
        </Text>
      </Pressable>

      {/* Lecteur + frise des voix */}
      <View style={st.player}>
        <Pressable onPress={togglePlay} style={st.playBtn} disabled={!player.loaded}>
          {player.playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </Pressable>
        <View style={{ flex: 1 }}>
          <Timeline segments={segments} duration={duration} position={player.position} onSeek={sec => seek(sec)} />
          <View style={st.rowBetween}>
            <Text style={st.time}>{formatTime(player.position)}</Text>
            <Text style={st.time}>{formatTime(duration)}</Text>
          </View>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={rec.status === 'done' ? segments : []}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        onScrollBeginDrag={() => player.playing && setFollow(false)}
        onScrollToIndexFailed={() => {}}
        renderItem={({ item, index }) => {
          const color = speakerColor(item.speaker);
          const active = index === activeIndex;
          return (
            <Pressable onPress={() => seek(item.start, true)} style={[st.seg, active && { backgroundColor: color + '1F', borderColor: color }]}>
              <View style={[st.segBar, { backgroundColor: color }]} />
              <View style={{ flex: 1 }}>
                <View style={st.rowBetween}>
                  <Text style={[st.segName, { color }]}>{speakerName(rec, item.speaker)}</Text>
                  <Text style={st.segTime}>{formatTime(item.start)}</Text>
                </View>
                <Text style={[st.segText, !item.text && { color: C.dim, fontStyle: 'italic' }]}>
                  {item.text || (rec.transcribed ? '(inaudible)' : `Prise de parole · ${Math.round(item.end - item.start)} s`)}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      <SpeakerModal
        rec={rec}
        speaker={editing}
        onClose={() => setEditing(null)}
        onRename={async (sp, name) => {
          await renameSpeaker(sp, name);
          setEditing(null);
        }}
        onMerge={mergeSpeaker}
        onListen={sp => {
          const first = segments.find(sg => sg.speaker === sp);
          if (first) seek(first.start, true);
        }}
      />

      <TitleModal visible={editingTitle} title={rec.title} onClose={() => setEditingTitle(false)} onSave={saveTitle} />
    </View>
  );
}

function Timeline({
  segments,
  duration,
  position,
  onSeek,
}: {
  segments: Segment[];
  duration: number;
  position: number;
  onSeek: (sec: number) => void;
}) {
  const [width, setWidth] = useState(1);
  const d = duration || 1;
  return (
    <View
      style={st.timeline}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderRelease={e => onSeek((e.nativeEvent.locationX / width) * d)}>
      <View style={st.timelineTrack} />
      {segments.map((sg, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[
            st.timelineSeg,
            { left: (sg.start / d) * width, width: Math.max(2, ((sg.end - sg.start) / d) * width), backgroundColor: speakerColor(sg.speaker) },
          ]}
        />
      ))}
      <View pointerEvents="none" style={[st.playhead, { left: Math.min(width - 2, (position / d) * width) }]} />
    </View>
  );
}

function SpeakerModal({
  rec,
  speaker,
  onClose,
  onRename,
  onMerge,
  onListen,
}: {
  rec: Recording;
  speaker: number | null;
  onClose: () => void;
  onRename: (speaker: number, name: string) => void;
  onMerge: (from: number, into: number) => void;
  onListen: (speaker: number) => void;
}) {
  const [name, setName] = useState('');
  useEffect(() => {
    if (speaker != null) setName(rec.speakers[String(speaker)] ?? '');
  }, [speaker, rec.speakers]);
  if (speaker == null) return null;
  const others = [...new Set((rec.segments ?? []).map(s => s.speaker))].filter(s => s !== speaker).sort((a, b) => a - b);
  const color = speakerColor(speaker);
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={st.modalBg}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={st.modal}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={[st.dot, { backgroundColor: color }]} />
            <Text style={st.modalTitle}>Qui est {speakerName({ ...rec, speakers: {} }, speaker)} ?</Text>
          </View>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Ex. : John"
            placeholderTextColor={C.dim}
            autoFocus
            style={st.input}
            selectionColor={C.accent}
            onSubmitEditing={() => onRename(speaker, name)}
            returnKeyType="done"
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="▶ Écouter" kind="ghost" onPress={() => onListen(speaker)} style={{ flex: 1 }} />
            <Button label="Enregistrer" onPress={() => onRename(speaker, name)} style={{ flex: 1 }} />
          </View>
          {others.length ? (
            <View style={{ marginTop: 18 }}>
              <Text style={st.cardText}>C'est en fait la même personne que… (fusionner)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {others.map(o => (
                  <Chip
                    key={o}
                    label={speakerName(rec, o)}
                    color={speakerColor(o)}
                    onPress={() =>
                      Alert.alert('Fusionner ?', `Toutes les interventions de « ${speakerName(rec, speaker)} » seront attribuées à « ${speakerName(rec, o)} ».`, [
                        { text: 'Annuler', style: 'cancel' },
                        { text: 'Fusionner', onPress: () => onMerge(speaker, o) },
                      ])
                    }
                  />
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function TitleModal({ visible, title, onClose, onSave }: { visible: boolean; title: string; onClose: () => void; onSave: (t: string) => void }) {
  const [value, setValue] = useState(title);
  useEffect(() => setValue(title), [title, visible]);
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={st.modalBg}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={st.modal}>
          <Text style={st.modalTitle}>Titre de la réunion</Text>
          <TextInput value={value} onChangeText={setValue} autoFocus style={st.input} selectionColor={C.accent} onSubmitEditing={() => onSave(value)} />
          <Button label="Enregistrer" onPress={() => onSave(value)} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const st = StyleSheet.create({
  iconBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: C.card },
  title: { color: C.text, fontSize: 22, fontWeight: '700' },
  meta: { color: C.sub, marginTop: 4 },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    margin: 16,
    marginBottom: 4,
    padding: 14,
    backgroundColor: C.card,
    borderRadius: 18,
  },
  playBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  timeline: { height: 28, justifyContent: 'center' },
  timelineTrack: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: C.border },
  timelineSeg: { position: 'absolute', height: 14, borderRadius: 3, top: 7 },
  playhead: { position: 'absolute', width: 2, height: 28, backgroundColor: '#fff', borderRadius: 1 },
  time: { color: C.dim, fontSize: 12, fontVariant: ['tabular-nums'] },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16 },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: '700' },
  cardText: { color: C.sub, marginTop: 6, lineHeight: 20 },
  section: { color: C.sub, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6, marginVertical: 10 },
  link: { color: C.accent, fontSize: 13, fontWeight: '600' },
  legend: { gap: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, padding: 12, borderRadius: 14 },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontWeight: '800', fontSize: 16 },
  personName: { color: C.text, fontWeight: '600', fontSize: 15 },
  personSub: { color: C.dim, fontSize: 12, marginTop: 2 },
  seg: {
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    marginBottom: 8,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segBar: { width: 3, borderRadius: 2 },
  segName: { fontWeight: '700', fontSize: 13 },
  segTime: { color: C.dim, fontSize: 12, fontVariant: ['tabular-nums'] },
  segText: { color: C.text, fontSize: 15, lineHeight: 22, marginTop: 4 },
  modalBg: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'center', padding: 24 },
  modal: { backgroundColor: C.card, borderRadius: 20, padding: 20, gap: 14 },
  modalTitle: { color: C.text, fontSize: 18, fontWeight: '700' },
  input: {
    backgroundColor: C.bg,
    color: C.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: C.border,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
});

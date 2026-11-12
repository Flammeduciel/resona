import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Easing, Permission, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProcessingState, Resona } from '../native';
import { deleteRecording, formatTime, listRecordings, Recording, startNewRecording } from '../store';
import { useInterval, useTheme, withAlpha } from '../theme';
import { Icon } from '../ui/Icon';
import { Avatar, FadeIn, haptic, IconButton, Row, s, Sheet, T, Tap, useToast } from '../ui/kit';
import { buildView } from '../view';

async function askPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const perms: Permission[] = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (Number(Platform.Version) >= 33) perms.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  const res = await PermissionsAndroid.requestMultiple(perms);
  return res[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
}

function sectionOf(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff <= 0) return 'Aujourd\'hui';
  if (diff === 1) return 'Hier';
  if (diff < 7) return 'Cette semaine';
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('fr-FR', { month: 'long' }).replace(/^./, c => c.toUpperCase());
  return String(d.getFullYear());
}

function timeLabel(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function HomeScreen({ focused, onOpen, onRecord, onSettings }: { focused: boolean; onOpen: (id: string) => void; onRecord: (id: string) => void; onSettings: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [items, setItems] = useState<Recording[] | null>(null);
  const [query, setQuery] = useState('');
  const [proc, setProc] = useState<ProcessingState | null>(null);
  const [menu, setMenu] = useState<Recording | null>(null);

  const refresh = useCallback(() => {
    listRecordings().then(setItems).catch(() => setItems([]));
  }, []);
  // rafraîchit à chaque retour sur l'écran
  useEffect(() => {
    if (focused) refresh();
  }, [focused, refresh]);

  const busy = items?.some(r => r.status === 'processing' || r.status === 'recording');
  useInterval(async () => {
    setProc(await Resona.getProcessingState());
    refresh();
  }, busy ? 1500 : null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items ?? [];
    return (items ?? []).filter(
      r => r.title.toLowerCase().includes(q) || (r.segments ?? []).some(sg => sg.text?.toLowerCase().includes(q)) || Object.values(r.speakers).some(n => n.toLowerCase().includes(q)),
    );
  }, [items, query]);

  const sections = useMemo(() => {
    const map = new Map<string, Recording[]>();
    for (const r of filtered) {
      const k = sectionOf(r.createdAt);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return [...map.entries()];
  }, [filtered]);

  const current = items?.find(r => r.status === 'recording');

  const record = async () => {
    if (current) return onRecord(current.id);
    try {
      if (!(await askPermissions())) {
        Alert.alert('Micro requis', 'Autorisez l\'accès au micro pour enregistrer vos réunions.');
        return;
      }
      haptic('heavy');
      const rec = await startNewRecording();
      onRecord(rec.id);
    } catch (e: any) {
      Alert.alert('Impossible de démarrer', e?.message ?? String(e));
    }
  };

  const remove = (r: Recording) =>
    Alert.alert('Supprimer cette réunion ?', 'L\'audio et la transcription seront définitivement effacés.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          await deleteRecording(r.id);
          haptic('success');
          toast('Réunion supprimée', 'check');
          refresh();
        },
      },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 150 + insets.bottom }} keyboardShouldPersistTaps="handled">
        <View style={[s.row, { alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18 }]}>
          <T v="largeTitle">Réunions</T>
          <IconButton name="gear" onPress={onSettings} iconSize={21} />
        </View>

        {items && items.length > 0 ? (
          <View style={[s.row, st.search, { backgroundColor: t.fill }]}>
            <Icon name="search" size={17} color={t.label2} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Rechercher un mot, une personne…"
              placeholderTextColor={t.label2}
              style={[st.searchInput, { color: t.label }]}
              selectionColor={t.accent}
              returnKeyType="search"
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={10}>
                <Icon name="close" size={15} color={t.label2} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {items && items.length === 0 ? <Empty /> : null}
        {items && items.length > 0 && filtered.length === 0 ? (
          <T v="subhead" c={t.label2} style={{ textAlign: 'center', marginTop: 40 }}>
            Aucun résultat pour « {query} »
          </T>
        ) : null}

        {sections.map(([title, recs], si) => (
          <FadeIn key={title} delay={si * 40} style={{ marginTop: 22, paddingHorizontal: 16 }}>
            <T v="title3" style={{ marginLeft: 4, marginBottom: 8 }}>
              {title}
            </T>
            <View style={{ backgroundColor: t.card, borderRadius: 14, overflow: 'hidden' }}>
              {recs.map((r, i) => (
                <View key={r.id}>
                  <MeetingRow rec={r} proc={proc} onPress={() => (r.status === 'recording' ? onRecord(r.id) : onOpen(r.id))} onLongPress={() => { haptic('heavy'); setMenu(r); }} />
                  {i < recs.length - 1 ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.separator, marginLeft: 16 }} /> : null}
                </View>
              ))}
            </View>
          </FadeIn>
        ))}
      </ScrollView>

      <RecordBar recording={current} onPress={record} />

      <Sheet visible={!!menu} onClose={() => setMenu(null)} title={menu?.title}>
        <View style={{ paddingHorizontal: 16, gap: 12 }}>
          <View style={{ backgroundColor: t.card, borderRadius: 12, overflow: 'hidden' }}>
            <Row title="Ouvrir" icon="headphones" iconBg="#007AFF" onPress={() => { const m = menu; setMenu(null); if (m) onOpen(m.id); }} />
          </View>
          <View style={{ backgroundColor: t.card, borderRadius: 12, overflow: 'hidden' }}>
            <Row title="Supprimer" icon="trash" iconBg={t.red} destructive onPress={() => { const m = menu; setMenu(null); if (m) remove(m); }} />
          </View>
        </View>
      </Sheet>
    </View>
  );
}

function MeetingRow({ rec, proc, onPress, onLongPress }: { rec: Recording; proc: ProcessingState | null; onPress: () => void; onLongPress: () => void }) {
  const t = useTheme();
  const view = useMemo(() => (rec.status === 'done' ? buildView(rec, t.dark) : null), [rec, t.dark]);
  const processing = rec.status === 'processing';
  const progress = processing && proc?.id === rec.id ? proc.progress : 0;
  const status =
    rec.status === 'recording'
      ? { label: 'En cours', color: t.red }
      : rec.status === 'recorded'
      ? { label: 'À analyser', color: t.orange }
      : rec.status === 'error'
      ? { label: 'Erreur', color: t.red }
      : processing
      ? { label: `${Math.round(progress * 100)} %`, color: t.accent }
      : null;

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} android_ripple={{ color: t.fill }} style={{ paddingHorizontal: 16, paddingVertical: 13 }}>
      <View style={[s.row, { alignItems: 'center', gap: 12 }]}>
        <View style={{ flex: 1 }}>
          <T v="headline" numberOfLines={1}>
            {rec.title}
          </T>
          <T v="subhead" c={t.label2} style={{ marginTop: 3 }}>
            {timeLabel(rec.createdAt)} · {formatTime(rec.duration)}
            {view ? ` · ${view.people.length} ${view.people.length > 1 ? 'personnes' : 'personne'}` : ''}
          </T>
        </View>
        {view ? (
          <View style={[s.row]}>
            {view.people.slice(0, 3).map((p, i) => (
              <View key={p.key} style={{ marginLeft: i ? -10 : 0, borderWidth: 2, borderColor: t.card, borderRadius: 16 }}>
                <Avatar name={p.name} color={p.color} size={28} />
              </View>
            ))}
          </View>
        ) : status ? (
          <View style={{ backgroundColor: withAlpha(status.color, 0.14), paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 }}>
            <T v="footnote" c={status.color} style={{ fontWeight: '700' }}>
              {status.label}
            </T>
          </View>
        ) : null}
        <Icon name="chevronRight" size={14} color={t.label3} />
      </View>
      {view && rec.duration > 0 ? <VoiceStrip view={view} duration={rec.duration} /> : null}
      {processing ? (
        <View style={{ height: 4, borderRadius: 2, backgroundColor: t.fill, marginTop: 10, overflow: 'hidden' }}>
          <View style={{ width: `${Math.max(3, progress * 100)}%`, height: 4, backgroundColor: t.accent, borderRadius: 2 }} />
        </View>
      ) : null}
    </Pressable>
  );
}

/** Mini-frise : qui parle quand, en couleurs. */
function VoiceStrip({ view, duration }: { view: ReturnType<typeof buildView>; duration: number }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  return (
    <View onLayout={e => setW(e.nativeEvent.layout.width)} style={{ height: 5, marginTop: 10, borderRadius: 3, backgroundColor: t.fill, overflow: 'hidden' }}>
      {w
        ? view.bubbles.map((b, i) => (
            <View
              key={i}
              style={{ position: 'absolute', top: 0, bottom: 0, left: (b.start / duration) * w, width: Math.max(1.5, ((b.end - b.start) / duration) * w), backgroundColor: view.people[b.person].color }}
            />
          ))
        : null}
    </View>
  );
}

function Empty() {
  const t = useTheme();
  const bars = [14, 26, 42, 30, 52, 36, 22, 40, 18];
  const colors = ['#0A84FF', '#FF9F0A', '#30D158'];
  return (
    <FadeIn style={{ alignItems: 'center', paddingHorizontal: 40, marginTop: 90 }}>
      <View style={[s.row, { alignItems: 'center', gap: 5, height: 60 }]}>
        {bars.map((h, i) => (
          <View key={i} style={{ width: 7, height: h, borderRadius: 4, backgroundColor: colors[i % 3] }} />
        ))}
      </View>
      <T v="title2" style={{ marginTop: 26, textAlign: 'center' }}>
        Qui a dit quoi, sans rien oublier
      </T>
      <T v="callout" c={t.label2} style={{ textAlign: 'center', marginTop: 10, lineHeight: 22 }}>
        Posez votre téléphone sur la table et lancez l'enregistrement. Resona reconnaît chaque voix et transcrit la réunion, directement sur
        l'appareil.
      </T>
    </FadeIn>
  );
}

/** Barre d'enregistrement façon Dictaphone. */
function RecordBar({ recording, onPress }: { recording?: Recording; onPress: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!recording) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingBottom: insets.bottom + 18,
        paddingTop: 16,
        alignItems: 'center',
        backgroundColor: t.dark ? 'rgba(18,18,20,0.96)' : 'rgba(249,249,251,0.96)',
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: t.separator,
      }}>
      {recording ? (
        <Tap onPress={onPress} style={[s.row, { alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 24, backgroundColor: withAlpha(t.red, 0.14) }]}>
          <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.red, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }) }} />
          <T v="headline" c={t.red}>
            Enregistrement en cours
          </T>
        </Tap>
      ) : (
        <Tap onPress={onPress} scale={0.92} hapticKind={null} style={[s.center, { width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: t.dark ? '#5A5A5E' : '#C7C7CC' }]}>
          <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: t.red }} />
        </Tap>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  search: { marginHorizontal: 16, marginTop: 12, borderRadius: 11, paddingHorizontal: 10, alignItems: 'center', gap: 6, height: 38 },
  searchInput: { flex: 1, fontSize: 17, paddingVertical: 0 },
});

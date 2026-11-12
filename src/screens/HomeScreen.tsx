import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Permission, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Header } from '../components';
import { formatTime, listRecordings, Recording, startNewRecording } from '../store';
import { C, speakerColor, useInterval } from '../theme';

const STATUS: Record<Recording['status'], { label: string; color: string }> = {
  recording: { label: 'En cours', color: C.rec },
  recorded: { label: 'À analyser', color: C.warn },
  processing: { label: 'Analyse…', color: C.accent },
  done: { label: 'Analysé', color: C.ok },
  error: { label: 'Erreur', color: C.rec },
};

async function askPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const perms: Permission[] = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (Number(Platform.Version) >= 33) perms.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  const res = await PermissionsAndroid.requestMultiple(perms);
  return res[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED;
}

export function HomeScreen({
  onOpen,
  onRecord,
  onSettings,
}: {
  onOpen: (id: string) => void;
  onRecord: (id: string) => void;
  onSettings: () => void;
}) {
  const [items, setItems] = useState<Recording[] | null>(null);

  const refresh = useCallback(() => {
    listRecordings().then(setItems).catch(() => setItems([]));
  }, []);

  useEffect(refresh, [refresh]);
  useInterval(refresh, items?.some(r => r.status === 'processing' || r.status === 'recording') ? 2000 : null);

  const record = async () => {
    try {
      if (!(await askPermissions())) {
        Alert.alert('Micro requis', 'Autorisez l\'accès au micro pour enregistrer vos réunions.');
        return;
      }
      const rec = await startNewRecording();
      onRecord(rec.id);
    } catch (e: any) {
      Alert.alert('Impossible de démarrer', e?.message ?? String(e));
    }
  };

  const current = items?.find(r => r.status === 'recording');

  return (
    <View style={{ flex: 1 }}>
      <Header
        title="Resona"
        right={
          <Pressable onPress={onSettings} hitSlop={10} style={st.settings}>
            <Text style={{ color: C.text, fontSize: 20 }}>⚙</Text>
          </Pressable>
        }
      />
      <Text style={st.tagline}>Qui a dit quoi, sans rien oublier.</Text>

      {items && items.length === 0 ? (
        <View style={st.empty}>
          <View style={st.emptyIcon}>
            {[0, 1, 2, 3, 4].map(i => (
              <View key={i} style={[st.wave, { height: [18, 34, 50, 30, 20][i], backgroundColor: speakerColor(i % 3) }]} />
            ))}
          </View>
          <Text style={st.emptyTitle}>Aucune réunion pour l'instant</Text>
          <Text style={st.emptyText}>
            Posez votre téléphone sur la table et appuyez sur le bouton. Resona enregistre, puis repère chaque voix et
            transcrit les échanges, directement sur le téléphone.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items ?? []}
          keyExtractor={r => r.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 10 }}
          renderItem={({ item }) => {
            const st2 = STATUS[item.status];
            const speakers = new Set(item.segments?.map(x => x.speaker) ?? []).size;
            return (
              <Pressable
                onPress={() => (item.status === 'recording' ? onRecord(item.id) : onOpen(item.id))}
                style={({ pressed }) => [st.card, pressed && { backgroundColor: C.cardHi }]}>
                <View style={{ flex: 1 }}>
                  <Text style={st.cardTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={st.cardSub}>
                    {formatTime(item.duration)}
                    {speakers ? `  ·  ${speakers} voix` : ''}
                  </Text>
                </View>
                <View style={[st.badge, { backgroundColor: st2.color + '22' }]}>
                  <Text style={[st.badgeTxt, { color: st2.color }]}>{st2.label}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <View style={st.fabWrap} pointerEvents="box-none">
        <Pressable
          onPress={current ? () => onRecord(current.id) : record}
          style={({ pressed }) => [st.fab, pressed && { transform: [{ scale: 0.96 }] }]}>
          <View style={st.fabDot} />
          <Text style={st.fabTxt}>{current ? 'Enregistrement en cours' : 'Enregistrer une réunion'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  settings: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  tagline: { color: C.sub, paddingHorizontal: 20, marginTop: -6, marginBottom: 4 },
  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { color: C.text, fontSize: 16, fontWeight: '600' },
  cardSub: { color: C.sub, marginTop: 4 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  badgeTxt: { fontSize: 12, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, paddingBottom: 100 },
  emptyIcon: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 24 },
  wave: { width: 8, borderRadius: 4 },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyText: { color: C.sub, textAlign: 'center', lineHeight: 21 },
  fabWrap: { position: 'absolute', left: 0, right: 0, bottom: 28, alignItems: 'center' },
  fab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.rec,
    paddingVertical: 16,
    paddingHorizontal: 26,
    borderRadius: 32,
    elevation: 6,
  },
  fabDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff' },
  fabTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },
});

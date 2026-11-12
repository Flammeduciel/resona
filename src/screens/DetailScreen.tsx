import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  PanResponder,
  Permission,
  PermissionsAndroid,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPaths, PlayerState, ProcessingState, Resona } from '../native';
import {
  deleteRecording,
  formatTime,
  loadRecording,
  loadSettings,
  MissingModelsError,
  Recording,
  runRemoteProcessing,
  saveRecording,
  startLocalProcessing,
  syncProcessingResult,
  wavPath,
} from '../store';
import { useInterval, useTheme, withAlpha } from '../theme';
import { Icon, IconName } from '../ui/Icon';
import { Avatar, Button, FadeIn, Group, haptic, IconButton, NavBar, Row, s, Segmented, Sheet, T, Tap, useToast } from '../ui/kit';
import { Bubble, buildView, exportMarkdown, exportSrt, exportText, MeetingView, Person, safeFileName } from '../view';

type Tab = 'talk' | 'people';
const SPEEDS = [1, 1.25, 1.5, 2];
const PEOPLE_CHOICES = [0, 2, 3, 4, 5, 6, 8];

export function DetailScreen({ id, onBack, onSettings, autoAnalyze }: { id: string; onBack: () => void; onSettings: () => void; autoAnalyze?: boolean }) {
  const t = useTheme();
  const toast = useToast();
  const [rec, setRec] = useState<Recording | null>(null);
  const [player, setPlayer] = useState<PlayerState>({ loaded: false, playing: false, position: 0, duration: 0 });
  const [proc, setProc] = useState<ProcessingState | null>(null);
  const [tab, setTab] = useState<Tab>('talk');
  const [filter, setFilter] = useState<number | null>(null); // lecture limitée à une personne
  const [sheet, setSheet] = useState<null | 'export' | 'menu' | 'analyze' | 'title' | { rename: number } | { merge: number } | { person: number }>(null);
  const [analyzePeople, setAnalyzePeople] = useState(0);
  const listRef = useRef<FlatList<Bubble>>(null);
  const lastActive = useRef(-1);
  const userScrolling = useRef(false);

  const reload = useCallback(async () => {
    const r = await loadRecording(id);
    setRec(r);
    return r;
  }, [id]);

  useEffect(() => {
    reload().then(r => {
      if (autoAnalyze && r && r.status === 'recorded') {
        loadSettings().then(st => setAnalyzePeople(st.numSpeakers));
        setTimeout(() => setSheet('analyze'), 350);
      }
    });
    (async () => {
      try {
        const d = await Resona.playerLoad(await wavPath(id));
        setPlayer(p => ({ ...p, loaded: true, duration: d }));
      } catch {}
    })();
    return () => {
      Resona.playerRelease();
    };
  }, [id, reload, autoAnalyze]);

  useInterval(async () => {
    const st = await Resona.playerState();
    setPlayer(st);
    if (!st.ranges && filter != null) setFilter(null);
  }, player.playing ? 200 : null);

  const processing = rec?.status === 'processing' && rec.engine !== 'remote';
  useInterval(async () => {
    const st = await Resona.getProcessingState();
    setProc(st);
    if (!st.running && rec) {
      await syncProcessingResult(rec);
      const r = await reload();
      if (r?.status === 'done') {
        haptic('success');
        toast('Analyse terminée', 'check');
      }
    }
  }, processing ? 600 : null);

  const view: MeetingView | null = useMemo(() => (rec && rec.status === 'done' ? buildView(rec, t.dark) : null), [rec, t.dark]);
  const duration = player.duration || rec?.duration || 0;

  const activeIndex = useMemo(() => {
    if (!view || !player.loaded || player.position <= 0) return -1;
    return view.bubbles.findIndex(b => player.position >= b.start - 0.05 && player.position < b.end + 0.25);
  }, [view, player.position, player.loaded]);

  useEffect(() => {
    if (tab === 'talk' && player.playing && activeIndex >= 0 && activeIndex !== lastActive.current && !userScrolling.current) {
      lastActive.current = activeIndex;
      listRef.current?.scrollToIndex({ index: activeIndex, viewPosition: 0.25, animated: true });
    }
  }, [activeIndex, player.playing, tab]);

  if (!rec) return <View style={{ flex: 1, backgroundColor: t.bg }} />;

  // ---------- Actions ----------

  const update = async (patch: Partial<Recording>) => {
    const r = { ...rec, ...patch };
    await saveRecording(r);
    setRec(r);
  };

  const refreshPlayer = async () => setPlayer(await Resona.playerState());

  const togglePlay = async () => {
    haptic('tap');
    if (player.playing) await Resona.playerPause();
    else await Resona.playerPlay();
    refreshPlayer();
  };

  const seek = async (sec: number, play = false) => {
    await Resona.playerSeek(Math.max(0, Math.min(duration, sec)));
    if (play) await Resona.playerPlay();
    refreshPlayer();
  };

  const playPerson = async (p: Person) => {
    haptic('select');
    if (filter === p.index && player.playing) {
      await Resona.playerPause();
      refreshPlayer();
      return;
    }
    await Resona.playerPlayRanges(p.ranges);
    setFilter(p.index);
    refreshPlayer();
  };

  const clearFilter = async () => {
    await Resona.playerClearRanges();
    setFilter(null);
  };

  const cycleSpeed = async () => {
    const cur = player.speed ?? 1;
    const next = SPEEDS[(SPEEDS.indexOf(cur) + 1) % SPEEDS.length];
    haptic('select');
    await Resona.playerSetSpeed(next);
    refreshPlayer();
  };

  const analyze = async (people: number) => {
    setSheet(null);
    const settings = await loadSettings();
    try {
      if (settings.engine === 'remote') {
        setRec({ ...rec, status: 'processing', engine: 'remote' });
        await runRemoteProcessing(rec, settings, people);
      } else {
        await startLocalProcessing(rec, settings, people);
      }
      await reload();
    } catch (e: any) {
      if (e instanceof MissingModelsError) {
        Alert.alert('Modèles à télécharger', e.message, [
          { text: 'Plus tard', style: 'cancel' },
          { text: 'Ouvrir les réglages', onPress: onSettings },
        ]);
      } else {
        Alert.alert('Analyse impossible', e?.message ?? String(e));
      }
      await reload();
    }
  };

  const openAnalyze = async () => {
    const st = await loadSettings();
    setAnalyzePeople(rec.people ?? st.numSpeakers);
    setSheet('analyze');
  };

  const remove = () =>
    Alert.alert('Supprimer cette réunion ?', 'L\'audio et la transcription seront définitivement effacés.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          await Resona.playerRelease();
          await deleteRecording(id);
          haptic('success');
          onBack();
        },
      },
    ]);

  /** Nombre de personnes : en dessous du résultat de l'analyse, fusion instantanée ; au-dessus, nouvelle analyse. */
  const setPeopleCount = (n: number) => {
    const max = rec.voices?.length ?? view?.people.length ?? 0;
    if (n <= max && rec.voices?.length) {
      haptic('select');
      update({ reduceTo: n >= max ? 0 : n, merges: [] });
    } else {
      Alert.alert(`${n} personnes ?`, 'L\'analyse va être relancée pour séparer les voix plus finement. Les noms déjà donnés seront perdus.', [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Relancer', onPress: () => analyze(n) },
      ]);
    }
  };

  // ---------- Rendu ----------

  const date = new Date(rec.createdAt);
  const meta = `${date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${formatTime(duration)}`;

  const header = (
    <View style={{ paddingHorizontal: 20, paddingBottom: 6 }}>
      <Pressable onPress={() => setSheet('title')}>
        <T v="title1" numberOfLines={2}>
          {rec.title}
        </T>
      </Pressable>
      <T v="subhead" c={t.label2} style={{ marginTop: 4 }}>
        {meta.charAt(0).toUpperCase() + meta.slice(1)}
      </T>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <NavBar
        backLabel="Réunions"
        onBack={onBack}
        right={
          <>
            {rec.status === 'done' ? <IconButton name="share" onPress={() => setSheet('export')} iconSize={19} /> : null}
            <IconButton name="more" onPress={() => setSheet('menu')} />
          </>
        }
      />

      {rec.status !== 'done' ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 200 }}>
          {header}
          <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
            {rec.status === 'processing' ? <ProcessingCard rec={rec} proc={proc} /> : <AnalyzeCard rec={rec} onAnalyze={openAnalyze} />}
          </View>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          {header}
          <Segmented
            style={{ marginHorizontal: 16, marginTop: 10, marginBottom: 6 }}
            items={[
              { key: 'talk', label: 'Conversation' },
              { key: 'people', label: `Participants · ${view?.people.length ?? 0}` },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === 'talk' && view ? (
            <FlatList
              ref={listRef}
              data={view.bubbles}
              keyExtractor={(_, i) => String(i)}
              contentContainerStyle={{ padding: 16, paddingBottom: 220 }}
              onScrollBeginDrag={() => (userScrolling.current = true)}
              onMomentumScrollEnd={() => setTimeout(() => (userScrolling.current = false), 2500)}
              onScrollToIndexFailed={() => {}}
              ListHeaderComponent={!rec.transcribed ? <NoTranscriptHint onSettings={onSettings} /> : undefined}
              renderItem={({ item, index }) => (
                <BubbleRow bubble={item} person={view.people[item.person]} active={index === activeIndex} transcribed={!!rec.transcribed} onPress={() => seek(item.start, true)} />
              )}
            />
          ) : null}
          {tab === 'people' && view ? (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 220, gap: 12 }}>
              <PeopleCount count={view.people.length} max={rec.voices?.length ?? view.people.length} onChange={setPeopleCount} />
              {view.people.map((p, i) => (
                <FadeIn key={p.key} delay={i * 50}>
                  <PersonCard
                    person={p}
                    playing={filter === p.index && player.playing}
                    onPlay={() => playPerson(p)}
                    onRename={() => setSheet({ rename: p.index })}
                    onMore={() => setSheet({ person: p.index })}
                  />
                </FadeIn>
              ))}
              <T v="footnote" c={t.label2} style={{ marginHorizontal: 6, lineHeight: 18 }}>
                Une même personne apparaît deux fois ? Touchez ••• puis « C'est la même personne que… ». Il manque quelqu'un ? Augmentez le nombre de
                personnes ci-dessus.
              </T>
            </ScrollView>
          ) : null}
        </View>
      )}

      <PlayerBar
        player={player}
        duration={duration}
        view={view}
        filterPerson={filter != null && view ? view.people[filter] : null}
        onToggle={togglePlay}
        onSeek={sec => seek(sec)}
        onSkip={d => seek(player.position + d)}
        onSpeed={cycleSpeed}
        onClearFilter={clearFilter}
      />

      {/* ----- Feuilles ----- */}
      <Sheet visible={sheet === 'analyze'} onClose={() => setSheet(null)} title="Combien de personnes parlent ?">
        <AnalyzeSheet value={analyzePeople} onChange={setAnalyzePeople} onGo={() => analyze(analyzePeople)} />
      </Sheet>

      <Sheet visible={sheet === 'menu'} onClose={() => setSheet(null)}>
        <View style={{ paddingHorizontal: 16, gap: 14 }}>
          <Group>
            <Row title="Renommer la réunion" icon="pencil" iconBg="#8E8E93" onPress={() => setSheet('title')} />
            {rec.status === 'done' ? <Row title="Exporter / partager" icon="share" iconBg="#007AFF" onPress={() => setSheet('export')} /> : null}
            {rec.status === 'done' || rec.status === 'error' ? <Row title="Relancer l'analyse" icon="refresh" iconBg="#5856D6" onPress={openAnalyze} /> : null}
          </Group>
          <Group>
            <Row title="Supprimer la réunion" icon="trash" iconBg={t.red} destructive onPress={() => { setSheet(null); remove(); }} />
          </Group>
        </View>
      </Sheet>

      <Sheet visible={sheet === 'title'} onClose={() => setSheet(null)} title="Titre de la réunion">
        <TextSheet initial={rec.title} placeholder="Titre" onSave={v => { update({ title: v.trim() || rec.title }); setSheet(null); }} />
      </Sheet>

      {view ? (
        <>
          <Sheet visible={sheet === 'export'} onClose={() => setSheet(null)} title="Exporter">
            <ExportSheet rec={rec} view={view} onDone={() => setSheet(null)} />
          </Sheet>

          <Sheet visible={!!sheet && typeof sheet === 'object' && 'rename' in sheet} onClose={() => setSheet(null)} title="Qui est-ce ?">
            {sheet && typeof sheet === 'object' && 'rename' in sheet ? (
              <RenameSheet
                person={view.people[sheet.rename]}
                onListen={() => playPerson(view.people[sheet.rename])}
                onSave={name => {
                  const p = view.people[sheet.rename];
                  const speakers = { ...rec.speakers };
                  if (name.trim()) speakers[p.key] = name.trim();
                  else delete speakers[p.key];
                  update({ speakers });
                  haptic('success');
                  setSheet(null);
                }}
              />
            ) : null}
          </Sheet>

          <Sheet visible={!!sheet && typeof sheet === 'object' && 'person' in sheet} onClose={() => setSheet(null)} title={sheet && typeof sheet === 'object' && 'person' in sheet ? view.people[sheet.person]?.name : ''}>
            {sheet && typeof sheet === 'object' && 'person' in sheet ? (
              <View style={{ paddingHorizontal: 16, gap: 14 }}>
                <Group>
                  <Row title="Renommer" icon="pencil" iconBg="#8E8E93" onPress={() => setSheet({ rename: (sheet as any).person })} />
                  <Row title="Écouter uniquement cette personne" icon="headphones" iconBg="#007AFF" onPress={() => { const p = view.people[(sheet as any).person]; setSheet(null); playPerson(p); }} />
                  <Row title="Exporter sa voix (audio)" icon="music" iconBg="#FF9500" onPress={() => setSheet('export')} />
                  {view.people.length > 1 ? <Row title="C'est la même personne que…" icon="merge" iconBg="#34C759" onPress={() => setSheet({ merge: (sheet as any).person })} /> : null}
                </Group>
              </View>
            ) : null}
          </Sheet>

          <Sheet visible={!!sheet && typeof sheet === 'object' && 'merge' in sheet} onClose={() => setSheet(null)} title="C'est la même personne que…">
            {sheet && typeof sheet === 'object' && 'merge' in sheet ? (
              <View style={{ paddingHorizontal: 16 }}>
                <Group footer="Toutes ses interventions seront attribuées à la personne choisie.">
                  {view.people
                    .filter(p => p.index !== (sheet as any).merge)
                    .map(p => (
                      <Row
                        key={p.key}
                        title={p.name}
                        subtitle={`${Math.round(p.share * 100)} % du temps de parole`}
                        right={<Avatar name={p.name} color={p.color} size={30} />}
                        onPress={() => {
                          const from = view.people[(sheet as any).merge];
                          update({ merges: [...(rec.merges ?? []), [p.anchor, from.anchor]] });
                          haptic('success');
                          toast(`Fusionné avec ${p.name}`, 'check');
                          setSheet(null);
                        }}
                      />
                    ))}
                </Group>
              </View>
            ) : null}
          </Sheet>
        </>
      ) : null}
    </View>
  );
}

// ---------- États avant l'analyse ----------

function AnalyzeCard({ rec, onAnalyze }: { rec: Recording; onAnalyze: () => void }) {
  const t = useTheme();
  const err = rec.status === 'error';
  return (
    <FadeIn>
      <View style={{ backgroundColor: t.card, borderRadius: 16, padding: 20, alignItems: 'center' }}>
        <View style={[s.center, { width: 56, height: 56, borderRadius: 28, backgroundColor: err ? withAlpha(t.red, 0.14) : t.accentSoft }]}>
          <Icon name={err ? 'close' : 'sparkles'} size={26} color={err ? t.red : t.accent} />
        </View>
        <T v="title3" style={{ marginTop: 14, textAlign: 'center' }}>
          {err ? 'L\'analyse n\'a pas abouti' : 'Prête à être analysée'}
        </T>
        <T v="subhead" c={t.label2} style={{ marginTop: 8, textAlign: 'center', lineHeight: 21 }}>
          {err ? rec.error ?? 'Erreur inconnue' : 'Resona va reconnaître les différentes voix, puis transcrire ce que chacun a dit. Tout se fait sur votre téléphone.'}
        </T>
        <Button label={err ? 'Réessayer' : 'Analyser la réunion'} icon="sparkles" onPress={onAnalyze} style={{ marginTop: 18, alignSelf: 'stretch' }} />
      </View>
    </FadeIn>
  );
}

function ProcessingCard({ rec, proc }: { rec: Recording; proc: ProcessingState | null }) {
  const t = useTheme();
  const remote = rec.engine === 'remote';
  const p = remote ? 0 : proc?.progress ?? 0;
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: p, duration: 600, useNativeDriver: false }).start();
  }, [p, anim]);
  return (
    <View style={{ backgroundColor: t.card, borderRadius: 16, padding: 20 }}>
      <View style={[s.row, { alignItems: 'center', gap: 12 }]}>
        <ActivityIndicator color={t.accent} />
        <View style={{ flex: 1 }}>
          <T v="headline">{remote ? 'Analyse sur le serveur…' : proc?.stage || 'Préparation…'}</T>
          <T v="footnote" c={t.label2} style={{ marginTop: 2 }}>
            {remote ? 'Merci de patienter' : `${Math.round(p * 100)} % · vous pouvez quitter l'application`}
          </T>
        </View>
      </View>
      {!remote ? (
        <>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: t.fill, marginTop: 16, overflow: 'hidden' }}>
            <Animated.View style={{ height: 6, borderRadius: 3, backgroundColor: t.accent, width: anim.interpolate({ inputRange: [0, 1], outputRange: ['2%', '100%'] }) }} />
          </View>
          <Button label="Annuler" kind="gray" small onPress={() => Resona.cancelProcessing()} style={{ marginTop: 16, alignSelf: 'flex-start' }} />
        </>
      ) : null}
    </View>
  );
}

function AnalyzeSheet({ value, onChange, onGo }: { value: number; onChange: (n: number) => void; onGo: () => void }) {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: 20 }}>
      <T v="subhead" c={t.label2} style={{ textAlign: 'center', lineHeight: 20 }}>
        Si vous le connaissez, indiquez le nombre de participants : la reconnaissance des voix sera bien plus fiable.
      </T>
      <View style={[s.row, { flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 20 }]}>
        {PEOPLE_CHOICES.map(n => {
          const on = value === n;
          return (
            <Tap
              key={n}
              onPress={() => onChange(n)}
              hapticKind="select"
              style={[s.center, { minWidth: n === 0 ? 150 : 56, height: 56, paddingHorizontal: 14, borderRadius: 16, backgroundColor: on ? t.accent : t.card }]}>
              <T v={n === 0 ? 'headline' : 'title2'} c={on ? '#fff' : t.label}>
                {n === 0 ? 'Je ne sais pas' : n === 8 ? '8+' : n}
              </T>
            </Tap>
          );
        })}
      </View>
      <Button label="Lancer l'analyse" icon="sparkles" onPress={onGo} style={{ marginTop: 24 }} />
    </View>
  );
}

function NoTranscriptHint({ onSettings }: { onSettings: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onSettings} style={{ backgroundColor: t.accentSoft, borderRadius: 12, padding: 12, marginBottom: 12 }}>
      <T v="footnote" c={t.accent} style={{ lineHeight: 18 }}>
        La transcription est désactivée : seuls les tours de parole sont affichés. Activez Whisper dans les réglages puis relancez l'analyse.
      </T>
    </Pressable>
  );
}

// ---------- Conversation ----------

const BubbleRow = React.memo(function BubbleRow({ bubble, person, active, transcribed, onPress }: { bubble: Bubble; person: Person; active: boolean; transcribed: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => { haptic('tap'); onPress(); }}
      style={[s.row, { gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 14, marginBottom: 2, backgroundColor: active ? withAlpha(person.color, t.dark ? 0.2 : 0.12) : 'transparent' }]}>
      <Avatar name={person.name} color={person.color} size={32} />
      <View style={{ flex: 1 }}>
        <View style={[s.row, { alignItems: 'baseline', gap: 8 }]}>
          <T v="subhead" c={person.color} style={{ fontWeight: '700' }}>
            {person.name}
          </T>
          <T v="caption" c={t.label2} style={{ fontVariant: ['tabular-nums'] }}>
            {formatTime(bubble.start)}
          </T>
        </View>
        <T v="body" c={bubble.text ? t.label : t.label2} style={{ marginTop: 3, lineHeight: 24, fontStyle: bubble.text ? 'normal' : 'italic' }}>
          {bubble.text || (transcribed ? 'Inaudible' : `Prise de parole · ${Math.max(1, Math.round(bubble.end - bubble.start))} s`)}
        </T>
      </View>
    </Pressable>
  );
});

// ---------- Participants ----------

function PeopleCount({ count, max, onChange }: { count: number; max: number; onChange: (n: number) => void }) {
  const t = useTheme();
  const options = [1, 2, 3, 4, 5, 6, 7, 8];
  return (
    <View style={{ backgroundColor: t.card, borderRadius: 16, padding: 16 }}>
      <T v="headline">Nombre de personnes</T>
      <T v="footnote" c={t.label2} style={{ marginTop: 3, lineHeight: 18 }}>
        Corrigez-le si besoin : en dessous de {max}, le regroupement est instantané.
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 12 }}>
        {options.map(n => {
          const on = n === count;
          return (
            <Tap key={n} onPress={() => n !== count && onChange(n)} hapticKind={null} style={[s.center, { width: 44, height: 44, borderRadius: 22, backgroundColor: on ? t.accent : t.fill }]}>
              <T v="headline" c={on ? '#fff' : n > max ? t.label2 : t.label}>
                {n}
              </T>
            </Tap>
          );
        })}
      </ScrollView>
    </View>
  );
}

function PersonCard({ person, playing, onPlay, onRename, onMore }: { person: Person; playing: boolean; onPlay: () => void; onRename: () => void; onMore: () => void }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.card, borderRadius: 16, padding: 16 }}>
      <View style={[s.row, { alignItems: 'center', gap: 12 }]}>
        <Tap onPress={onRename} scale={0.92}>
          <Avatar name={person.name} color={person.color} size={46} />
        </Tap>
        <Pressable style={{ flex: 1 }} onPress={onRename}>
          <View style={[s.row, { alignItems: 'center', gap: 6 }]}>
            <T v="headline" numberOfLines={1}>
              {person.name}
            </T>
            {!person.named ? <Icon name="pencil" size={14} color={t.label3} /> : null}
          </View>
          <T v="footnote" c={t.label2} style={{ marginTop: 2 }}>
            {person.turns} intervention{person.turns > 1 ? 's' : ''} · {formatTime(person.duration)}
          </T>
        </Pressable>
        <T v="title3" c={person.color}>
          {Math.round(person.share * 100)} %
        </T>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: t.fill, marginTop: 14, overflow: 'hidden' }}>
        <View style={{ width: `${Math.max(2, person.share * 100)}%`, height: 6, borderRadius: 3, backgroundColor: person.color }} />
      </View>
      <View style={[s.row, { gap: 10, marginTop: 14 }]}>
        <Button label={playing ? 'Pause' : 'Écouter'} icon={playing ? 'pause' : 'headphones'} kind="tinted" color={person.color} small onPress={onPlay} style={{ flex: 1, height: 38 }} />
        <Tap onPress={onMore} style={[s.center, { width: 44, height: 38, borderRadius: 10, backgroundColor: t.fill }]}>
          <Icon name="more" size={18} color={t.label} />
        </Tap>
      </View>
    </View>
  );
}

// ---------- Lecteur ----------

function PlayerBar({
  player,
  duration,
  view,
  filterPerson,
  onToggle,
  onSeek,
  onSkip,
  onSpeed,
  onClearFilter,
}: {
  player: PlayerState;
  duration: number;
  view: MeetingView | null;
  filterPerson: Person | null;
  onToggle: () => void;
  onSeek: (sec: number) => void;
  onSkip: (d: number) => void;
  onSpeed: () => void;
  onClearFilter: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [w, setW] = useState(1);
  const [drag, setDrag] = useState<number | null>(null);
  const d = duration || 1;
  const pos = drag ?? player.position;
  const wRef = useRef(1);
  wRef.current = w;
  const dRef = useRef(d);
  dRef.current = d;
  const seekRef = useRef(onSeek);
  seekRef.current = onSeek;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: e => setDrag(Math.max(0, Math.min(1, e.nativeEvent.locationX / wRef.current)) * dRef.current),
        onPanResponderMove: e => setDrag(Math.max(0, Math.min(1, e.nativeEvent.locationX / wRef.current)) * dRef.current),
        onPanResponderRelease: e => {
          const sec = Math.max(0, Math.min(1, e.nativeEvent.locationX / wRef.current)) * dRef.current;
          setDrag(null);
          haptic('select');
          seekRef.current(sec);
        },
        onPanResponderTerminate: () => setDrag(null),
      }),
    [],
  );

  return (
    <View
      style={{
        position: 'absolute',
        left: 10,
        right: 10,
        bottom: insets.bottom + 10,
        backgroundColor: t.dark ? '#2C2C2E' : '#FFFFFF',
        zIndex: 50,
        borderRadius: 22,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 12,
        elevation: 12,
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 6 },
      }}>
      {filterPerson ? (
        <Pressable onPress={onClearFilter} style={[s.row, { alignSelf: 'center', alignItems: 'center', gap: 6, backgroundColor: withAlpha(filterPerson.color, 0.16), paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, marginBottom: 10 }]}>
          <Icon name="headphones" size={14} color={filterPerson.color} />
          <T v="footnote" c={filterPerson.color} style={{ fontWeight: '700' }}>
            Uniquement {filterPerson.name}
          </T>
          <Icon name="close" size={12} color={filterPerson.color} />
        </Pressable>
      ) : null}
      <View onLayout={e => setW(e.nativeEvent.layout.width)} {...pan.panHandlers} style={{ height: 26, justifyContent: 'center' }}>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: t.fill, overflow: 'hidden' }}>
          {view
            ? view.bubbles.map((b, i) => (
                <View
                  key={i}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: (b.start / d) * w,
                    width: Math.max(1.5, ((b.end - b.start) / d) * w),
                    backgroundColor: view.people[b.person].color,
                    opacity: filterPerson && filterPerson.index !== b.person ? 0.2 : 1,
                  }}
                />
              ))
            : <View style={{ width: `${(pos / d) * 100}%`, height: 6, backgroundColor: t.accent }} />}
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: Math.max(0, Math.min(w - (drag != null ? 18 : 12), (pos / d) * w - (drag != null ? 9 : 6))),
            width: drag != null ? 18 : 12,
            height: drag != null ? 18 : 12,
            borderRadius: 9,
            backgroundColor: t.dark ? '#fff' : '#1C1C1E',
            borderWidth: 2,
            borderColor: t.dark ? '#2C2C2E' : '#fff',
          }}
        />
      </View>
      <View style={[s.row, { justifyContent: 'space-between', marginTop: 2 }]}>
        <T v="caption" c={t.label2} style={{ fontVariant: ['tabular-nums'] }}>
          {formatTime(pos)}
        </T>
        <T v="caption" c={t.label2} style={{ fontVariant: ['tabular-nums'] }}>
          -{formatTime(Math.max(0, d - pos))}
        </T>
      </View>
      <View style={[s.row, { alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }]}>
        <Tap onPress={onSpeed} hapticKind={null} style={[s.center, { width: 52, height: 32, borderRadius: 10, backgroundColor: t.fill }]}>
          <T v="subhead" style={{ fontWeight: '700' }}>
            {(player.speed ?? 1).toString().replace('.', ',')}×
          </T>
        </Tap>
        <View style={[s.row, { alignItems: 'center', gap: 22 }]}>
          <Tap onPress={() => onSkip(-15)} scale={0.85}>
            <Icon name="back15" size={30} color={t.label} strokeWidth={1.7} />
          </Tap>
          <Tap onPress={onToggle} scale={0.88} hapticKind={null} style={[s.center, { width: 56, height: 56, borderRadius: 28, backgroundColor: t.accent }]}>
            <Icon name={player.playing ? 'pause' : 'play'} size={24} color="#fff" />
          </Tap>
          <Tap onPress={() => onSkip(15)} scale={0.85}>
            <Icon name="fwd15" size={30} color={t.label} strokeWidth={1.7} />
          </Tap>
        </View>
        <View style={{ width: 52 }} />
      </View>
    </View>
  );
}

// ---------- Feuilles ----------

function TextSheet({ initial, placeholder, onSave }: { initial: string; placeholder: string; onSave: (v: string) => void }) {
  const t = useTheme();
  const [v, setV] = useState(initial);
  return (
    <View style={{ paddingHorizontal: 16, gap: 14 }}>
      <TextInput
        value={v}
        onChangeText={setV}
        placeholder={placeholder}
        placeholderTextColor={t.label3}
        autoFocus
        selectionColor={t.accent}
        onSubmitEditing={() => onSave(v)}
        returnKeyType="done"
        style={{ backgroundColor: t.card, color: t.label, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 17 }}
      />
      <Button label="Enregistrer" onPress={() => onSave(v)} />
    </View>
  );
}

function RenameSheet({ person, onSave, onListen }: { person: Person; onSave: (name: string) => void; onListen: () => void }) {
  const t = useTheme();
  const [v, setV] = useState(person.named ? person.name : '');
  return (
    <View style={{ paddingHorizontal: 16, gap: 14 }}>
      <View style={{ alignItems: 'center', marginBottom: 4 }}>
        <Avatar name={v || person.name} color={person.color} size={64} />
      </View>
      <TextInput
        value={v}
        onChangeText={setV}
        placeholder={`Nom de « ${person.name} »`}
        placeholderTextColor={t.label3}
        autoFocus
        autoCapitalize="words"
        selectionColor={t.accent}
        onSubmitEditing={() => onSave(v)}
        returnKeyType="done"
        style={{ backgroundColor: t.card, color: t.label, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 17, textAlign: 'center' }}
      />
      <View style={[s.row, { gap: 10 }]}>
        <Button label="Écouter" icon="headphones" kind="tinted" color={person.color} onPress={onListen} style={{ flex: 1 }} />
        <Button label="Enregistrer" onPress={() => onSave(v)} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

type ExportKind = 'txt' | 'md' | 'srt' | 'audio' | 'voices' | { person: number };

function ExportSheet({ rec, view, onDone }: { rec: Recording; view: MeetingView; onDone: () => void }) {
  const t = useTheme();
  const toast = useToast();
  const [dest, setDest] = useState<'share' | 'save'>('share');
  const [busy, setBusy] = useState<string | null>(null);
  const base = safeFileName(rec.title);

  const run = async (kind: ExportKind, key: string) => {
    if (busy) return;
    setBusy(key);
    try {
      const paths = await getPaths();
      const files: { path: string; name: string; mime: string }[] = [];
      const wav = await wavPath(rec.id);
      if (kind === 'txt' || kind === 'md' || kind === 'srt') {
        const content = kind === 'txt' ? exportText(rec, view) : kind === 'md' ? exportMarkdown(rec, view) : exportSrt(rec, view);
        const name = `${base}.${kind}`;
        const path = `${paths.exports}/${name}`;
        await Resona.writeText(path, content);
        files.push({ path, name, mime: kind === 'md' ? 'text/markdown' : kind === 'srt' ? 'application/x-subrip' : 'text/plain' });
      } else if (kind === 'audio') {
        const name = `${base}.m4a`;
        const path = `${paths.exports}/${name}`;
        await Resona.exportAudio(wav, path, null);
        files.push({ path, name, mime: 'audio/mp4' });
      } else {
        const people = kind === 'voices' ? view.people : [view.people[kind.person]];
        for (const p of people) {
          const name = `${base}-${safeFileName(p.name)}.m4a`;
          const path = `${paths.exports}/${name}`;
          await Resona.exportAudio(wav, path, p.ranges);
          files.push({ path, name, mime: 'audio/mp4' });
        }
      }
      if (dest === 'share') {
        const mime = files.every(f => f.mime === files[0].mime) ? files[0].mime : '*/*';
        await Resona.shareFiles(
          files.map(f => f.path),
          mime,
          rec.title,
        );
        onDone();
      } else {
        if (paths.sdk < 29) {
          const ok = await PermissionsAndroid.request('android.permission.WRITE_EXTERNAL_STORAGE' as Permission);
          if (ok !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Autorisation de stockage refusée');
        }
        for (const f of files) await Resona.saveToDownloads(f.path, f.name, f.mime);
        haptic('success');
        toast(files.length > 1 ? `${files.length} fichiers dans Téléchargements/Resona` : 'Enregistré dans Téléchargements/Resona', 'check');
        onDone();
      }
    } catch (e: any) {
      Alert.alert('Export impossible', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const R = ({ k, title, subtitle, icon, bg, kind }: { k: string; title: string; subtitle: string; icon: IconName; bg: string; kind: ExportKind }) => (
    <Row title={title} subtitle={subtitle} icon={icon} iconBg={bg} onPress={() => run(kind, k)} right={busy === k ? <ActivityIndicator color={t.accent} /> : <Icon name={dest === 'share' ? 'share' : 'download'} size={18} color={t.accent} />} />
  );

  return (
    <ScrollView style={{ maxHeight: 620 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 20, paddingBottom: 8 }}>
      <Segmented
        items={[
          { key: 'share', label: 'Partager' },
          { key: 'save', label: 'Enregistrer' },
        ]}
        value={dest}
        onChange={setDest}
      />
      <Group header="Transcription">
        <R k="txt" title="Texte" subtitle="Fichier .txt, lisible partout" icon="doc" bg="#007AFF" kind="txt" />
        <R k="md" title="Document Markdown" subtitle="Pour Notion, Obsidian, Word…" icon="doc" bg="#5856D6" kind="md" />
        <R k="srt" title="Sous-titres" subtitle="Fichier .srt avec les horaires" icon="doc" bg="#8E8E93" kind="srt" />
      </Group>
      <Group header="Audio" footer="Format M4A : léger et lisible sur tous les appareils. « Voix » = uniquement les passages de la personne, mis bout à bout.">
        <R k="audio" title="Réunion complète" subtitle={`Audio · ${formatTime(rec.duration)}`} icon="music" bg="#FF9500" kind="audio" />
        {view.people.length > 1 ? <R k="voices" title="Chaque personne séparément" subtitle={`${view.people.length} fichiers audio`} icon="people" bg="#34C759" kind="voices" /> : null}
        {view.people.map(p => (
          <R key={p.key} k={`p${p.index}`} title={p.named ? `Voix de ${p.name}` : `Audio de la ${p.name}`} subtitle={`${formatTime(p.duration)} de parole`} icon="person" bg={p.color} kind={{ person: p.index }} />
        ))}
      </Group>
    </ScrollView>
  );
}

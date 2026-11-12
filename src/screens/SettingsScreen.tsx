import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, TextInput, View } from 'react-native';
import { deletePack, DIARIZATION_PACK, ModelPack, PackProgress, packProgress, packSize, startPackDownload, WHISPER_OPTIONS, whisperPack } from '../models';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, Settings } from '../store';
import { formatBytes, useInterval, useTheme } from '../theme';
import { Icon } from '../ui/Icon';
import { Button, Group, haptic, NavBar, Row, s, T, Tap } from '../ui/kit';

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const [st, setSt] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadSettings().then(v => {
      setSt(v);
      setLoaded(true);
    });
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...st, ...patch };
    setSt(next);
    saveSettings(next);
  };

  if (!loaded) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  const local = st.engine === 'local';

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <NavBar backLabel="Réunions" onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60, gap: 28 }} keyboardShouldPersistTaps="handled">
        <T v="largeTitle" style={{ marginLeft: 4 }}>
          Réglages
        </T>

        <Group
          header="Analyse"
          footer={local ? 'Tout reste sur votre téléphone, sans connexion (une fois les modèles téléchargés).' : 'L\'audio est envoyé à votre serveur, qui renvoie les voix et la transcription.'}>
          <Row title="Sur le téléphone" subtitle="Privé, hors ligne" icon="mic" iconBg="#34C759" checked={local} onPress={() => update({ engine: 'local' })} />
          <Row title="Serveur externe" subtitle="Plus rapide sur les longues réunions" icon="share" iconBg="#007AFF" checked={!local} onPress={() => update({ engine: 'remote' })} />
        </Group>

        {local ? (
          <>
            <Group header="Modèles" footer="Téléchargés une seule fois, de préférence en Wi-Fi.">
              <PackRow pack={DIARIZATION_PACK} />
              {st.whisper !== 'none' ? <PackRow pack={whisperPack(st.whisper)} /> : null}
            </Group>
            <Group header="Transcription" footer={st.whisper === 'none' ? 'Seuls les tours de parole seront calculés : très rapide.' : 'Comptez quelques minutes d\'analyse par tranche de 10 minutes de réunion avec Base.'}>
              {WHISPER_OPTIONS.map(w => {
                const p = whisperPack(w);
                return <Row key={w} title={p.label} subtitle={`${p.description} ${formatBytes(packSize(p))}`} checked={st.whisper === w} onPress={() => update({ whisper: w })} />;
              })}
              <Row title="Désactivée" subtitle="Uniquement qui parle et quand" checked={st.whisper === 'none'} onPress={() => update({ whisper: 'none' })} />
            </Group>
          </>
        ) : (
          <Group header="Serveur" footer={'Le serveur reçoit le fichier WAV (champ « audio ») et répond en JSON : { "segments": [{ "start", "end", "speaker", "text" }] }. Un serveur prêt à l\'emploi est fourni dans le dossier server/ du projet.'}>
            <Field value={st.remoteUrl} placeholder="https://mon-serveur.com/analyze" onChange={v => update({ remoteUrl: v.trim() })} />
            <Field value={st.remoteKey} placeholder="Clé d'API (facultatif)" secure onChange={v => update({ remoteKey: v.trim() })} />
          </Group>
        )}

        <Group header="Langue des réunions">
          <Row title="Français" checked={st.language === 'fr'} onPress={() => update({ language: 'fr' })} />
          <Row title="Anglais" checked={st.language === 'en'} onPress={() => update({ language: 'en' })} />
          <Row title="Détection automatique" checked={st.language === 'auto'} onPress={() => update({ language: 'auto' })} />
        </Group>

        <Group header="Participants par défaut" footer="Proposé au lancement de chaque analyse. Indiquer le bon nombre rend la reconnaissance des voix bien plus fiable.">
          <View style={[s.row, { flexWrap: 'wrap', gap: 8, padding: 14 }]}>
            {[0, 2, 3, 4, 5, 6].map(n => {
              const on = st.numSpeakers === n;
              return (
                <Tap key={n} hapticKind="select" onPress={() => update({ numSpeakers: n })} style={[s.center, { height: 38, minWidth: 44, paddingHorizontal: 12, borderRadius: 19, backgroundColor: on ? t.accent : t.fill }]}>
                  <T v="subhead" c={on ? '#fff' : t.label} style={{ fontWeight: '600' }}>
                    {n === 0 ? 'Demander' : n}
                  </T>
                </Tap>
              );
            })}
          </View>
        </Group>

        <Group header="Séparation des voix (mode automatique)" footer="Une même personne apparaît en plusieurs voix ? Choisissez « Regrouper davantage ». Deux personnes confondues ? « Séparer davantage ».">
          <Row title="Regrouper davantage" checked={st.sensitivity === 'fewer'} onPress={() => update({ sensitivity: 'fewer' })} />
          <Row title="Équilibré" checked={st.sensitivity === 'normal'} onPress={() => update({ sensitivity: 'normal' })} />
          <Row title="Séparer davantage" checked={st.sensitivity === 'more'} onPress={() => update({ sensitivity: 'more' })} />
        </Group>

        <View style={{ alignItems: 'center', gap: 4 }}>
          <T v="footnote" c={t.label2}>
            Resona 0.2.0
          </T>
          <T v="caption" c={t.label3}>
            Reconnaissance des voix et transcription sur l'appareil
          </T>
        </View>
      </ScrollView>
    </View>
  );
}

function Field({ value, placeholder, onChange, secure }: { value: string; placeholder: string; onChange: (v: string) => void; secure?: boolean }) {
  const t = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={t.label3}
      autoCapitalize="none"
      autoCorrect={false}
      secureTextEntry={secure}
      selectionColor={t.accent}
      style={{ color: t.label, fontSize: 17, paddingHorizontal: 16, paddingVertical: 14 }}
    />
  );
}

function PackRow({ pack }: { pack: ModelPack }) {
  const t = useTheme();
  const [p, setP] = useState<PackProgress | null>(null);
  const refresh = useCallback(() => {
    packProgress(pack).then(setP);
  }, [pack]);
  useEffect(refresh, [refresh]);
  useInterval(refresh, p?.downloading ? 400 : null);

  const pct = p && p.total ? p.bytes / p.total : 0;
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
      <View style={[s.row, { alignItems: 'center', gap: 12 }]}>
        <View style={[s.center, { width: 30, height: 30, borderRadius: 7, backgroundColor: pack.id === 'voices' ? '#FF9500' : '#5856D6' }]}>
          <Icon name={pack.id === 'voices' ? 'people' : 'doc'} size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <T v="body">{pack.label}</T>
          <T v="footnote" c={p?.error ? t.red : t.label2} style={{ marginTop: 2 }}>
            {p?.error ? `Erreur : ${p.error}` : p?.downloading ? `${formatBytes(p.bytes)} sur ${formatBytes(p.total)}` : formatBytes(packSize(pack))}
          </T>
        </View>
        {p?.installed ? (
          <Tap
            onPress={() =>
              Alert.alert('Supprimer le modèle ?', 'Il faudra le retélécharger pour analyser.', [
                { text: 'Annuler', style: 'cancel' },
                { text: 'Supprimer', style: 'destructive', onPress: async () => { await deletePack(pack); refresh(); } },
              ])
            }
            style={[s.row, { alignItems: 'center', gap: 4 }]}>
            <Icon name="check" size={16} color={t.green} />
            <T v="subhead" c={t.green} style={{ fontWeight: '600' }}>
              Installé
            </T>
          </Tap>
        ) : p?.downloading ? (
          <T v="subhead" c={t.accent} style={{ fontWeight: '600', fontVariant: ['tabular-nums'] }}>
            {Math.round(pct * 100)} %
          </T>
        ) : (
          <Button
            label={p?.error ? 'Réessayer' : 'Obtenir'}
            kind="tinted"
            small
            onPress={async () => {
              haptic('tap');
              await startPackDownload(pack);
              setTimeout(refresh, 300);
            }}
          />
        )}
      </View>
      {p?.downloading ? (
        <View style={{ height: 4, borderRadius: 2, backgroundColor: t.fill, marginTop: 12, marginLeft: 42, overflow: 'hidden' }}>
          <View style={{ width: `${Math.max(2, pct * 100)}%`, height: 4, borderRadius: 2, backgroundColor: t.accent }} />
        </View>
      ) : null}
    </View>
  );
}

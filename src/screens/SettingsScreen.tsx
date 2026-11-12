import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Chip, Header, ProgressBar } from '../components';
import {
  deletePack,
  DIARIZATION_PACK,
  ModelPack,
  PackProgress,
  packProgress,
  packSize,
  startPackDownload,
  WHISPER_OPTIONS,
  whisperPack,
} from '../models';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, Settings } from '../store';
import { C, formatBytes, useInterval } from '../theme';

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    loadSettings().then(v => {
      setS(v);
      setLoaded(true);
    });
  }, []);

  const update = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
  };

  if (!loaded) return <View style={{ flex: 1 }} />;

  return (
    <View style={{ flex: 1 }}>
      <Header title="Réglages" onBack={onBack} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 22 }} keyboardShouldPersistTaps="handled">
        <Section title="Moteur d'analyse">
          <Row>
            <Chip label="Sur le téléphone" active={s.engine === 'local'} onPress={() => update({ engine: 'local' })} />
            <Chip label="Serveur externe" active={s.engine === 'remote'} onPress={() => update({ engine: 'remote' })} />
          </Row>
          <Text style={st.help}>
            {s.engine === 'local'
              ? 'Tout reste sur votre téléphone, sans connexion (après téléchargement des modèles).'
              : 'L\'audio est envoyé à votre serveur, qui renvoie les voix et la transcription.'}
          </Text>
        </Section>

        {s.engine === 'local' ? (
          <>
            <Section title="Modèles locaux">
              <PackRow pack={DIARIZATION_PACK} />
              {s.whisper !== 'none' ? <PackRow pack={whisperPack(s.whisper)} /> : null}
            </Section>

            <Section title="Transcription (Whisper)">
              <Row>
                <Chip label="Désactivée" active={s.whisper === 'none'} onPress={() => update({ whisper: 'none' })} />
                {WHISPER_OPTIONS.map(w => (
                  <Chip
                    key={w}
                    label={`${w[0].toUpperCase()}${w.slice(1)} · ${formatBytes(packSize(whisperPack(w)))}`}
                    active={s.whisper === w}
                    onPress={() => update({ whisper: w })}
                  />
                ))}
              </Row>
              <Text style={st.help}>
                {s.whisper === 'none'
                  ? 'Seuls les tours de parole (qui parle quand) seront calculés. Très rapide.'
                  : whisperPack(s.whisper).description + ' Une réunion d\'une heure peut demander plusieurs minutes d\'analyse.'}
              </Text>
            </Section>
          </>
        ) : (
          <Section title="Serveur">
            <TextInput
              value={s.remoteUrl}
              onChangeText={t => update({ remoteUrl: t.trim() })}
              placeholder="https://mon-serveur.com/analyze"
              placeholderTextColor={C.dim}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={st.input}
            />
            <TextInput
              value={s.remoteKey}
              onChangeText={t => update({ remoteKey: t.trim() })}
              placeholder="Clé d'API (facultatif)"
              placeholderTextColor={C.dim}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={st.input}
            />
            <Text style={st.help}>
              Le serveur reçoit le fichier WAV (champ « audio ») et doit répondre en JSON : {'{'} "segments": [{'{'} "start",
              "end", "speaker", "text" {'}'}] {'}'}. Voir le dossier server/ du projet.
            </Text>
          </Section>
        )}

        <Section title="Langue de la réunion">
          <Row>
            <Chip label="Français" active={s.language === 'fr'} onPress={() => update({ language: 'fr' })} />
            <Chip label="Anglais" active={s.language === 'en'} onPress={() => update({ language: 'en' })} />
            <Chip label="Détection auto" active={s.language === 'auto'} onPress={() => update({ language: 'auto' })} />
          </Row>
        </Section>

        <Section title="Nombre de participants">
          <Row>
            <Chip label="Auto" active={s.numSpeakers === 0} onPress={() => update({ numSpeakers: 0 })} />
            {[2, 3, 4, 5, 6, 8].map(n => (
              <Chip key={n} label={String(n)} active={s.numSpeakers === n} onPress={() => update({ numSpeakers: n })} />
            ))}
          </Row>
          <Text style={st.help}>Si vous connaissez le nombre de personnes, l'indiquer améliore nettement le résultat.</Text>
        </Section>

        {s.numSpeakers === 0 ? (
          <Section title="Séparation des voix (mode auto)">
            <Row>
              <Chip label="Moins de voix" active={s.sensitivity === 'fewer'} onPress={() => update({ sensitivity: 'fewer' })} />
              <Chip label="Normal" active={s.sensitivity === 'normal'} onPress={() => update({ sensitivity: 'normal' })} />
              <Chip label="Plus de voix" active={s.sensitivity === 'more'} onPress={() => update({ sensitivity: 'more' })} />
            </Row>
            <Text style={st.help}>
              Une même personne est découpée en plusieurs voix ? Choisissez « Moins de voix ». Deux personnes sont confondues ?
              Choisissez « Plus de voix ».
            </Text>
          </Section>
        ) : null}

        <Text style={[st.help, { textAlign: 'center', marginTop: 10 }]}>Resona 0.1.0 · moteur sherpa-onnx</Text>
      </ScrollView>
    </View>
  );
}

function PackRow({ pack }: { pack: ModelPack }) {
  const [p, setP] = useState<PackProgress | null>(null);
  const refresh = useCallback(() => {
    packProgress(pack).then(setP);
  }, [pack]);
  useEffect(refresh, [refresh]);
  useInterval(refresh, p?.downloading ? 500 : null);

  return (
    <View style={st.pack}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text style={st.packTitle}>{pack.label}</Text>
          <Text style={st.help}>
            {pack.description} · {formatBytes(packSize(pack))}
          </Text>
        </View>
        {p?.installed ? <Text style={{ color: C.ok, fontWeight: '700' }}>✓ Installé</Text> : null}
      </View>
      {p && !p.installed ? (
        p.downloading ? (
          <View style={{ marginTop: 12, gap: 6 }}>
            <ProgressBar value={p.total ? p.bytes / p.total : 0} />
            <Text style={st.help}>
              {formatBytes(p.bytes)} / {formatBytes(p.total)}
            </Text>
          </View>
        ) : (
          <View style={{ marginTop: 12 }}>
            {p.error ? <Text style={[st.help, { color: C.rec, marginBottom: 8 }]}>Erreur : {p.error}</Text> : null}
            <Button
              label={p.error ? 'Réessayer' : 'Télécharger'}
              onPress={async () => {
                await startPackDownload(pack);
                setTimeout(refresh, 300);
              }}
            />
          </View>
        )
      ) : null}
      {p?.installed ? (
        <Button
          label="Supprimer"
          kind="ghost"
          style={{ marginTop: 12, paddingVertical: 9 }}
          onPress={() =>
            Alert.alert('Supprimer le modèle ?', 'Il faudra le retélécharger pour analyser.', [
              { text: 'Annuler', style: 'cancel' },
              {
                text: 'Supprimer',
                style: 'destructive',
                onPress: async () => {
                  await deletePack(pack);
                  refresh();
                },
              },
            ])
          }
        />
      ) : null}
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={st.section}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
}

const st = StyleSheet.create({
  section: { color: C.sub, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  help: { color: C.dim, fontSize: 13, lineHeight: 19, marginTop: 2 },
  pack: { backgroundColor: C.card, borderRadius: 16, padding: 14 },
  packTitle: { color: C.text, fontWeight: '700', fontSize: 15 },
  input: {
    backgroundColor: C.card,
    color: C.text,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: C.border,
  },
});

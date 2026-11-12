# Resona

**Qui a dit quoi, sans rien oublier.**

Resona enregistre une réunion avec le téléphone posé sur la table. Il repère ensuite les différentes voix
(« Voix A », « Voix B »…) et transcrit ce que chacun a dit. On nomme les participants (« John », « Jack »), puis
on réécoute la réunion en suivant la conversation.

Tout se fait **sur le téléphone, hors ligne** : l'audio ne quitte jamais l'appareil. Un serveur externe
peut être branché en option.

## Fonctionnalités (v0.2 — Android)

- **Enregistrement** en arrière-plan (écran verrouillé, notification Pause / Arrêter), WAV 16 kHz.
- **Reconnaissance des voix** sur l'appareil : découpage fin (pyannote 3.0), empreintes vocales
  (TitaNet), puis regroupement par personne et réattribution aux micro-pauses. On peut indiquer le
  nombre de participants au lancement de l'analyse, ou le corriger ensuite :
  - à la baisse, le regroupement est instantané ;
  - à la hausse, l'analyse est relancée.
- **Transcription** Whisper (tiny / base / small) sur l'appareil.
- **Conversation** : chaque intervention avec la personne, l'heure et le texte. On touche une phrase
  pour l'écouter, et le texte suit la lecture.
- **Participants** : temps de parole, nombre d'interventions, renommage, écoute de **une seule
  personne** (ses passages enchaînés), fusion « c'est la même personne ».
- **Lecteur** : frise colorée par personne, déplacement au doigt, ±15 s, vitesse 1× à 2×.
- **Exports** (partage ou enregistrement dans Téléchargements/Resona) :
  - transcription en texte, Markdown ou sous-titres SRT ;
  - audio M4A de la réunion complète ;
  - audio M4A **par personne**.
- Interface claire / sombre automatique, transitions animées, retours haptiques.
- Moteur au choix : local ou serveur externe (voir `server/`).

### Qualité de la séparation des voix

Mesurée sur des réunions de test (voix de synthèse, écho et bruit de salle) :

| Réunion | v0.1 | v0.2 automatique | v0.2 avec le nombre indiqué |
| --- | --- | --- | --- |
| 2 personnes | 5 voix | 2 | 2 |
| 2 personnes, conditions difficiles | 14 voix | 5 | 2 |
| 3 personnes | – | 2 | 3 |
| 4 personnes | – | 4 | 4 |

## Architecture

```
App.tsx, src/            Interface React Native (TypeScript)
  native.ts              Pont typé vers le module natif
  grouping.ts            Regroupement instantané des voix (empreintes)
  view.ts                Vue « personnes / conversation » + exports texte
  ui/                    Kit d'interface (thème, icônes, feuilles, contrôles)
  store.ts               Réunions, réglages, orchestration local / serveur
  models.ts              Catalogue et téléchargement des modèles
  screens/               Accueil, Enregistrement, Réunion, Réglages
android/app/src/main/java/com/resona/core/
  RecordingService.kt    Service au premier plan (micro) → WAV
  ProcessingService.kt   Service au premier plan pour l'analyse (longue)
  Processor.kt           Pipeline : diarisation → regroupement → réattribution → Whisper
  AudioExporter.kt       Export M4A (AAC), complet ou par personne
  Downloader.kt          Téléchargement des modèles avec progression
  ResonaModule.kt        Module React Native (fichiers, enregistrement, analyse, lecteur)
server/                  Serveur d'analyse optionnel (FastAPI + même pipeline)
```

Les modèles ne sont pas inclus dans l'APK. L'application les télécharge une seule fois depuis
**Réglages** :

| Pack | Taille |
| --- | --- |
| Reconnaissance des voix (obligatoire) | ~46 Mo |
| Whisper Tiny | ~104 Mo |
| Whisper Base (recommandé) | ~160 Mo |
| Whisper Small | ~376 Mo |

## Compiler l'APK

Prérequis : Node 22+, JDK 17+, Android SDK (plateforme 37, build-tools 37, NDK 27.1).

```bash
npm install
cd android
./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

Au premier build, la bibliothèque `sherpa-onnx` (AAR) est téléchargée automatiquement dans
`android/app/libs/`.

> L'APK de release est actuellement signé avec la clé de debug : à remplacer par une vraie clé avant
> une publication sur le Play Store.

## Serveur externe (optionnel)

Voir `server/app.py`. Contrat :

```
POST /analyze   (multipart/form-data)
  audio=<fichier wav>  language=fr|en|auto  num_speakers=0..n
  Authorization: Bearer <clé>   (facultatif)
→ { "segments": [ { "start": 0.0, "end": 3.2, "speaker": 0, "text": "…" } ] }
```

Dans l'application : **Réglages → Moteur d'analyse → Serveur externe**, puis saisir l'adresse
`https://…/analyze`.

## Feuille de route

- [ ] Rapport / compte rendu automatique par IA (résumé, décisions, actions)
- [ ] Reconnaître une voix déjà nommée d'une réunion à l'autre (empreintes mémorisées)
- [ ] Import de fichiers audio existants
- [ ] Recherche dans les transcriptions
- [ ] Version iOS

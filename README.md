# Resona

**Qui a dit quoi, sans rien oublier.**

Resona enregistre une réunion avec le téléphone posé sur la table. Il repère ensuite les différentes voix
(« Voix A », « Voix B »…) et transcrit ce que chacun a dit. On nomme les participants (« John », « Jack »), puis
on réécoute la réunion en suivant la conversation.

Tout se fait **sur le téléphone, hors ligne** : l'audio ne quitte jamais l'appareil. Un serveur externe
peut être branché en option.

## Fonctionnalités (v0.1 — Android)

- Enregistrement en arrière-plan : écran verrouillé, avec une notification Pause / Arrêter. Format WAV
  16 kHz mono, et le fichier reste lisible même si l'application est tuée.
- Diarisation locale (« qui parle quand ») : segmentation pyannote 3.0 + empreintes vocales NVIDIA TitaNet
  + clustering.
- Transcription locale avec Whisper (tiny / base / small), tour de parole par tour de parole.
- Lecteur avec une frise colorée par voix. On touche une phrase pour l'écouter, et la lecture suit la
  conversation.
- Renommage des voix, et fusion de deux voix quand une même personne a été découpée en deux.
- Partage de la transcription en texte.
- Moteur au choix : local ou serveur externe (voir `server/`).

## Architecture

```
App.tsx, src/            Interface React Native (TypeScript)
  native.ts              Pont typé vers le module natif
  store.ts               Réunions, réglages, orchestration local / serveur
  models.ts              Catalogue et téléchargement des modèles
  screens/               Accueil, Enregistrement, Réunion, Réglages
android/app/src/main/java/com/resona/core/
  RecordingService.kt    Service au premier plan (micro) → WAV
  ProcessingService.kt   Service au premier plan pour l'analyse (longue)
  Processor.kt           Pipeline : diarisation sherpa-onnx → Whisper par tour de parole
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

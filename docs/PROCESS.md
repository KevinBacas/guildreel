# Processus interne

Ce document explique comment l’outil passe des messages Discord au montage local. Les étapes sont séparées afin de pouvoir relancer une opération sans recommencer celles qui ont déjà réussi.

## Vue d’ensemble

```text
Discord API → data/clips.json → yt-dlp metadata → downloads/
                                      ↓                  ↓
                              data/clips.csv       review.json
                                                         ↓
                                                FFmpeg + cache/
                                                         ↓
                                                output/best-of-YYYY.mp4
```

`data/clips.json` conserve la liste complète et l’état de traitement de chaque clip. `data/review.json` conserve la sélection, les scores modifiés et le mode d’ordre utilisé par le rendu.

## 1. Lecture de Discord

La commande `npm run scan` utilise un compte bot Discord via `discord.js`. Elle lit les variables `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CHANNEL_ID` et `DISCORD_YEAR` depuis `.env`.

Le bot récupère l’historique par pages de 100 messages, du plus récent vers le plus ancien, et arrête la pagination une fois passé le début de l’année demandée. La plage est interprétée en UTC : du 1er janvier à 00:00 inclus au 1er janvier de l’année suivante exclu.

Pour chaque message de l’année, le scanner cherche des liens Medal dans le texte, les champs d’embed et les URL de pièces jointes. Il extrait l’identifiant du clip depuis le chemin du lien. Cet identifiant sert de clé de déduplication : un même clip lié plusieurs fois ne devient qu’une seule entrée.

Chaque occurrence Discord conserve l’identifiant et l’URL du message, l’auteur, la date de publication, le total des réactions et le nombre associé à chaque emoji. Si un clip apparaît dans plusieurs messages, toutes ses occurrences sont conservées et leurs réactions sont additionnées dans `discordReactions`. Chaque page est sauvegardée pour réduire la perte de progression en cas d’interruption. Le CSV source est réécrit à la fin du scan.

## 2. Métadonnées Medal

`npm run metadata` transmet chaque URL directement à `yt-dlp` et utilise son extracteur MedalTV. Il demande le JSON sans télécharger la vidéo, puis conserve les champs disponibles : titre, joueur Medal, date de mise en ligne, durée, vues, likes, commentaires, miniature et URL vidéo.

Une extraction réussie est marquée `ok` et n’est pas répétée au prochain lancement. Une erreur est conservée sur le clip avec son état `failed`; l’étape pourra réessayer ce clip plus tard sans affecter les autres. Le score est recalculé depuis `config/scoring.json` et la progression est sauvegardée après chaque clip.

## 3. Téléchargements

`npm run download` utilise encore `yt-dlp`, avec reprise et nouvelles tentatives. Les téléchargements sont limités par `DOWNLOAD_CONCURRENCY` (2 par défaut, plafonné à 4). Les fichiers existants sont détectés par identifiant de clip et ne sont pas téléchargés à nouveau. Les clips indisponibles restent dans les métadonnées avec l’erreur associée.

Les fichiers d’origine sont écrits dans `downloads/`. L’extension dépend du conteneur réellement fourni par Medal; le chemin relatif obtenu est enregistré dans `clips.json`.

## 4. Revue et ordre final

`npm run review` lance l’API Express et l’interface React/Vite sur `127.0.0.1:4173`. Le serveur n’écoute que sur la machine locale. L’interface lit les clips depuis JSON et les vidéos locales via `/media/<clip-id>`.

La sélection, l’ordre personnalisé, le mode de tri et les scores modifiés sont automatiquement sauvegardés dans `data/review.json`. Le tri affiché dans le menu est également le tri appliqué au montage : score combiné, vues, likes, réactions Discord, chronologique ou aléatoire. Par défaut, le score combiné est trié du plus élevé au plus faible. En mode « Custom drag order », l’ordre des cartes déplacées devient l’ordre du rendu.

Pour le score, les termes et coefficients sont définis dans `config/scoring.json`. La limite `MAX_CLIPS_PER_UPLOADER` sert uniquement à former la sélection initiale; les clips écartés restent sélectionnables dans l’interface.

## 5. Montage vidéo

`npm run render` suit cet ordre :

1. Charger les clips sélectionnés et les écarter s’ils n’ont pas de téléchargement local terminé.
2. Appliquer le même mode de tri que celui affiché dans l’interface.
3. Pour chaque clip, préparer un segment normalisé dans `cache/`.
4. Assembler les segments dans l’ordre calculé sans ajouter d’écran d’introduction.
5. Écrire le MP4 et les manifests CSV/JSON classés dans `output/`.

Les segments sont mis à l’échelle en 1920×1080 en conservant leur ratio, centrés sur un fond noir, convertis à 60 fps, puis encodés en H.264. L’audio est nivelé avec `loudnorm`, encodé en AAC à 48 kHz et remplacé par du silence si la source n’en contient pas. Les segments ont les mêmes réglages, ce qui permet de les concaténer sans réencoder une seconde fois le montage complet.

Pendant les deux premières secondes de chaque clip, le rendu affiche une petite carte avec son titre et sa date. La date Medal est utilisée si elle existe; sinon l’outil prend la date du message Discord. Si aucune date n’est disponible, la carte indique « Date inconnue ». Aucun compteur de vues, de likes ou de réactions n’est affiché.

La carte est dessinée en PNG avec `@resvg/resvg-js`, puis superposée par le filtre FFmpeg `overlay`. Cette méthode fonctionne avec les installations FFmpeg qui ne comprennent pas le filtre `drawtext`. La clé du cache comprend le fichier source et les champs de la carte; un nouveau titre, une nouvelle date ou une nouvelle vidéo force donc la création d’un nouveau segment.

## Fichiers créés

| Chemin | Contenu |
| --- | --- |
| `data/clips.json` | Métadonnées, occurrences Discord, score et états d’erreur |
| `data/clips.csv` | Vue tabulaire des clips après le scan |
| `data/review.json` | Sélection, ordre, tri et scores personnalisés |
| `downloads/` | Vidéos Medal téléchargées |
| `cache/` | Segments normalisés et fichiers temporaires de rendu |
| `output/best-of-YYYY.mp4` | Montage vidéo final |
| `output/best-of-YYYY-clips.csv` | Classement final et métadonnées tabulaires |
| `output/best-of-YYYY-clips.json` | Classement final avec toutes les métadonnées et occurrences Discord |

Les données personnelles du serveur et les vidéos sont locales et ignorées par Git. Le token Discord doit rester dans `.env` et ne doit jamais être ajouté aux fichiers suivis par Git.

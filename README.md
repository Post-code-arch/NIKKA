# NIKKA

Interface nodale de génération image/vidéo IA pour la préproduction (voir `PRD.md`).
App locale, mono-utilisateur, provider unique Atlas Cloud.

## Démarrage

```bash
npm install
cp .env.example .env.local   # renseigner ATLASCLOUD_API_KEY
npm run dev                   # http://localhost:3000
```

Prérequis : Node ≥ 20, `ffmpeg` dans le PATH (extraction de frames, médias factices du mode mock).

### Lanceur (macOS)

Double-clique sur **`NIKKA.command`** à la racine du dossier. Il récupère la dernière version, installe les dépendances si besoin, démarre l'app en mode mock et l'ouvre dans le navigateur. Ferme la fenêtre Terminal pour arrêter NIKKA.

Le mode mock est activé par défaut. Pour passer en réel (générations facturées), mets `NIKKA_MOCK_ATLAS=0` dans `.env.local`.

## Scripts

| Commande | Rôle |
|---|---|
| `npm run atlas:smoke:mock` | Smoke test Atlas sans appel réseau (`NIKKA_MOCK_ATLAS=1`) |
| `npm run atlas:smoke` | Dry run gratuit : lit le catalogue et les schémas Atlas, choisit les modèles, construit les requêtes et affiche le coût estimé, sans rien envoyer |
| `npm run atlas:smoke -- --live` | Test payant : 1 appel LLM, 1 texte → image (modèle image le moins cher), 1 image → vidéo. Arrêt si > `NIKKA_SMOKE_MAX_USD` (0,5 $ par défaut) |
| `npm run typecheck` / `npm run lint` / `npm test` | Vérifications |

## Tester sans dépenser

```bash
NIKKA_MOCK_ATLAS=1 npm run dev
```

Onglet **Storyboard** : crée un projet, une séquence et un plan, écris l'action, puis clique sur « Image clé ». Le coût estimé s'affiche avant chaque lancement. La prise passe « En file » → « En cours » → terminée, et le fichier est stocké dans `storage/assets/`. « Animer » lance ensuite une vidéo à partir de la prise retenue. En mode mock, les images et vidéos sont factices et rien n'est facturé.

### Bible et références (phase 2)

Panneau **Bible** à gauche du Storyboard et du Canvas :
- **+** crée un personnage, un lieu, un objet ou un look. Dans sa fiche, tu écris le descripteur (injecté tel quel dans les prompts), tu importes des images et tu étiquettes chaque vue (face, trois-quarts, profil, en pied…). Tu peux aussi ajouter des variantes (« Costume de nuit », « Blessé »).
- **Assistant pack de référence** : à partir d'une image source ou du descripteur seul, il génère les vues standard. Tu valides celles à garder, ou tu relances une vue.
- **Tester la sélection** : compare les vues envoyées au modèle pour deux échelles de plan (par exemple gros plan et plan large), avec l'angle et le nombre d'images maximum.

### Langage caméra (phase 3)

Clique sur une carte de plan pour ouvrir sa **fiche** à droite :
- l'échelle, l'angle et le mouvement se choisissent par pictos ; la vitesse, l'optique et la profondeur de champ par pastilles ;
- tu branches les références de la bible et tu choisis les modèles image clé et vidéo du projet ;
- si le modèle vidéo ne sait pas faire le mouvement choisi, une alerte propose un modèle compatible ;
- l'aperçu du **prompt final** se met à jour à chaque changement : descripteurs (jamais réécrits), action du plan, caméra, look. On voit aussi les vues de référence envoyées.

« Image clé » et « Animer » partent de ce prompt assemblé, qui reste modifiable avant le lancement.

### Canvas et recettes (phase 4)

Onglet **Canvas** :
- **Vue séquence** : chaque plan est une recette repliée en un bloc (image retenue, références, pictos caméra). Boutons **Image clé**, **×4** (4 variantes, avec confirmation du total) et **Animer**. Glisse une référence de la bible sur un bloc pour la brancher.
- **Double-clic sur un plan** (ou ⤢) : la recette se déplie en nodes — Référence, Sélection des vues, Prompt, Image (texte → image ou édition multi-réf), Vidéo, Extraction d'image, Prise. Les ports sont typés et colorés ; un lien entre types différents est refusé.
- **+ Node** ou **double-clic sur le fond** : ajoute un node. **Suppr** efface. Les positions et les liens sont enregistrés.
- Recettes : Plan personnage, Plan lieu / ambiance, Plan objet / produit, Continuité (part de la dernière image du plan précédent), Libre.
- Sur chaque node de génération : modèle, seed avec verrou, variantes, coût estimé et état des prises. Le node Prise montre toutes les prises : un clic retient celle qui part en animation.
- Une référence locale peut être promue avec **Ajouter à la bible**.

## Organisation

- `lib/atlas` — client Atlas côté serveur uniquement : upload, génération, polling (backoff + timeout), téléchargement dans `storage/assets/<sha256>.<ext>`, catalogue et schémas d'entrée des modèles, LLM (SDK `openai`), mode mock.
- `db` — schéma Drizzle (PRD §5) et migrations SQLite, base dans `data/nikka.db`.
- `lib/models` — registre de modèles et adapters `mapInputs`. Les modèles Atlas réels ne sont ajoutés qu'après validation.
- `lib/generation`, `lib/jobs` — création des prises (jamais d'écrasement, coût confirmé au-dessus du seuil) et poller serveur qui télécharge les sorties dès la complétion.
- `lib/camera` — vocabulaire caméra : libellés FR, formulation anglaise par valeur, surcharges et capacités par modèle (`phrasing.ts`).
- `lib/prompt` — assemblage du prompt d'un plan (`build.ts`) et aperçu par étape (`shot.ts`).
- `lib/graph` — types de nodes et de ports (`types.ts`), moteur d'exécution serveur du graphe d'un plan (`run.ts`).
- `lib/recipes` — recettes (sous-graphes prédéfinis) et synchronisation des références.
- `lib/refs` — sélection automatique des vues selon l'échelle du plan (`select.ts`, testé), assistant de pack (`pack.ts`), libellés des vues.
- `app/api` — routes CRUD projets / séquences / plans / références, génération, `/api/jobs`, `/api/assets/:id`.
- `storage/assets`, `data` — médias et base locale (non versionnés).

Avancement par phases : voir `PROMPTS.md`.

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

Panneau **Bible** à gauche du Storyboard :
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

### Canvas nodal libre (phase 4)

Le **Storyboard** reste la voie rigide (Image clé, Animer, fiche du plan). Le **Canvas** est **un seul grand canvas par projet**, indépendant des séquences et des plans, vide au départ.
- **+ Node** ou **double-clic sur le fond** ajoute l'un des nodes : **Texte**, **Image** (import), **Vidéo** (import), **Prompt enhancer**, **Texte → image**, **Texte → vidéo**, **Image → vidéo**.
- **Glisse une sortie (ou une entrée) dans le vide** : NIKKA propose aussitôt les nodes compatibles, et le nouveau node arrive déjà relié.
- **Prompt enhancer** (node LLM) : branche un Texte dessus, choisis « pour une image / une vidéo », ajoute une consigne si tu veux, puis **Améliorer**. Le prompt enrichi (modifiable) sort vers les générateurs. Si le texte d'entrée change, le node le signale ; on relance quand on veut (pas d'appel automatique). Coût LLM affiché sur le node ; instructions du LLM dans `lib/digester/prompts/enhance.md`.
- **Choix du modèle par node** : chaque générateur (et le Prompt enhancer pour le LLM) a son sélecteur. En mode réel, il liste les modèles activés et cherche dans tout le catalogue Atlas, avec le prix de base ; en ajouter un lit son schéma publié pour configurer l'appel (seuls les champs du schéma sont envoyés ; un modèle dont les champs requis ne sont pas compris est refusé). Une sélection recommandée s'active au premier lancement en mode réel. Liste locale : `data/models.json`.
- Relie les ports de même couleur (texte vert, image bleu, vidéo rose) ; les autres liens sont refusés. Plusieurs Textes sur un même prompt sont mis bout à bout. **Suppr** efface.
- Chaque node de génération a son modèle, sa durée (vidéo), son seed (avec verrou), ses variantes (confirmation du total pour tout lot) et son coût estimé. Ses **résultats restent dans le canvas** : clique sur une vignette pour choisir celle qui part vers les nodes suivants.
- Optionnel : **Envoyer au plan…** propose la liste des plans du storyboard ; le résultat devient une prise de ce plan.

### Brief digester (phase 5)

Onglet **Brief** : colle un brief (une phrase, un concept, un découpage complet) puis **Analyser le brief**.
- **Jauge de maturité** : idée → concept → traitement → découpage, avec ce qui manque à chaque niveau.
- Ce que le brief contient est **extrait** tel quel (badge gris) ; le premier niveau manquant est **proposé** (ambre). Depuis une simple idée : 2 à 3 pistes de concept, tu en choisis une.
- Chaque champ s'édite sur place (il passe en **validé**, vert). **Valider ce niveau**, **Régénérer**, **Descendre au niveau suivant**.
- Valider le **traitement** crée les références de la bible (sans images ; une référence existante n'est jamais réécrite). Valider le **découpage** crée les séquences et les plans, avec leurs références, leur caméra et leur durée. Rien n'est généré en image ou en vidéo.
- Un découpage collé tel quel est reconnu niveau 4 et peut être validé directement, sans rien inventer au-dessus.
- Les prompts du LLM sont dans `lib/digester/prompts/*.md`, modifiables sans recompiler. Sorties validées par Zod, une seule nouvelle tentative avec l'erreur.
- Mode mock : lecture par règles et propositions gabarits « [mock] », gratuites. En réel : `NIKKA_LLM_MODEL` dans `.env.local` ; le coût estimé d'un appel s'affiche sous le bouton. Exemples de sorties : `docs/digester-samples.md`.

### Storyboard (phase 6)

- **Planche** (grille par séquence) ou **Timeline** (chaque plan à sa durée réelle, règle en secondes).
- Carte de plan : prise retenue (la vidéo se lit au survol), numéro, durée, pictos échelle et mouvement, **flèche du mouvement dessinée sur l'image**, statut, badge « proposé / extrait » tant que le plan n'est pas validé, dialogue et son dépliables, coût estimé et réel, carrousel des prises (clic = prise retenue).
- **Glisser la poignée** pour réordonner, y compris vers une autre séquence. **+** entre deux cartes insère un plan ; les ciseaux **coupent un plan en deux** (durée partagée) ; la corbeille le supprime.
- **Remplissage par étapes** sur chaque séquence : **Crayonné** (modèle esquisse, style imposé, pour juger le découpage à faible coût), **Images clés**, **Animation** (seulement les plans qui ont une image clé ; un crayonné ne s'anime pas). Toujours une modale avec le coût total estimé à confirmer.
- **Sélection multiple** : case à cocher ou ⌘/Maj-clic, puis la barre du bas lance l'étape choisie sur la sélection.
- **Filtres** par statut, personnage, lieu (le glisser-déposer est désactivé pendant un filtre).
- **Animatique** d'une séquence : enchaîne les prises retenues aux durées des plans (vidéo, ou image fixe avec zoom lent, ou texte de l'action si pas d'image). Espace = pause, Échap = fermer.

## Organisation

- `lib/atlas` — client Atlas côté serveur uniquement : upload, génération, polling (backoff + timeout), téléchargement dans `storage/assets/<sha256>.<ext>`, catalogue et schémas d'entrée des modèles, LLM (SDK `openai`), mode mock.
- `db` — schéma Drizzle (PRD §5) et migrations SQLite, base dans `data/nikka.db`.
- `lib/models` — registre de modèles et adapters `mapInputs`. Les modèles Atlas réels ne sont ajoutés qu'après validation.
- `lib/generation`, `lib/jobs` — création des prises (jamais d'écrasement, coût confirmé au-dessus du seuil) et poller serveur qui télécharge les sorties dès la complétion.
- `lib/camera` — vocabulaire caméra : libellés FR, formulation anglaise par valeur, surcharges et capacités par modèle (`phrasing.ts`).
- `lib/prompt` — assemblage du prompt d'un plan (`build.ts`) et aperçu par étape (`shot.ts`).
- `lib/graph` — les 6 nodes et leurs ports (`types.ts`), moteur serveur du canvas du projet (`run.ts`) : résultats (`node_runs`) et envoi optionnel à un plan.
- `lib/digester` — digester du brief : schémas Zod, prompts en fichiers séparés, appel LLM avec une nouvelle tentative, mock par règles, création des références et des plans.
- `lib/storyboard` — déplacement, insertion et découpe des plans ; génération par lots (crayonné, images clés, animation) avec coût total confirmé.
- `lib/refs` — sélection automatique des vues selon l'échelle du plan (`select.ts`, testé), assistant de pack (`pack.ts`), libellés des vues.
- `app/api` — routes CRUD projets / séquences / plans / références, génération, `/api/jobs`, `/api/assets/:id`.
- `storage/assets`, `data` — médias et base locale (non versionnés).

Avancement par phases : voir `PROMPTS.md`.

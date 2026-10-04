# NIKKA — prompts de build pour Claude Code

Place `PRD.md`, `CLAUDE.md` et ce fichier à la racine d'un dossier vide, ouvre Claude Code dedans, puis envoie les prompts un par un.
Valide chaque phase toi-même (lance l'app, clique) avant de passer à la suivante.

---

## Phase 0 — Socle et client Atlas

```
Lis PRD.md et CLAUDE.md. Initialise le projet Next.js (App Router, TypeScript strict, Tailwind, shadcn/ui) avec la structure de dossiers du PRD §3.

Puis construis /lib/atlas :
- upload d'un fichier local (uploadMedia)
- soumission image et vidéo (generateImage, generateVideo)
- polling d'une prédiction avec backoff et timeout
- téléchargement des outputs dans ./storage/assets avec hash sha256
- client LLM via le SDK openai pointé sur https://api.atlascloud.ai/v1
- mode mock activé par NIKKA_MOCK_ATLAS=1

Tout est validé par Zod. Écris un script `npm run atlas:smoke` qui fait : 1 appel LLM court, 1 génération d'image texte → image avec le modèle image le moins cher que tu trouves, puis 1 image → vidéo à partir de cette image. Vérifie les schémas exacts des modèles via leurs pages llms.txt avant de coder les appels.

Critère : le smoke test passe en mock, puis en réel avec ma clé.
```

## Phase 1 — Données et registre de modèles

```
Implémente le schéma Drizzle du PRD §5 (Project, Sequence, Shot, Take, Reference, ReferenceVariant, Asset, Job) avec SQLite dans ./data/nikka.db, et les routes CRUD.

Construis le registre /lib/models (PRD §4). Explore le catalogue Atlas et propose-moi une sélection pour les rôles listés en §4 « Modèles nécessaires en V1 » : un tableau avec ID, rôle, prix, nb max de références, support image de début/fin, durées. Vérifie chaque ligne sur la page llms.txt du modèle. Attends ma validation de la sélection avant de remplir le registre.

Ajoute le poller de jobs côté serveur (PRD §3) et la route /api/jobs.

Critère : je peux créer un projet, une séquence, un plan, lancer une génération de test et voir la Take passer de queued à completed avec le fichier stocké localement.
```

## Phase 2 — Bible et références

```
Implémente la bible et les références (PRD §7) :
- panneau Bible à gauche, groupé par tag, avec variantes
- création d'une référence par upload d'images, avec tag de vue (face_front, face_34, etc.)
- assistant de pack de référence : à partir d'une image source, générer les vues standard d'un personnage via le modèle d'édition multi-références, validation vue par vue
- /lib/refs : la sélection automatique de vues selon l'échelle du plan (tableau du §7), avec tests unitaires couvrant chaque échelle et le dépassement de slots

Critère : je crée un personnage avec son pack, et une fonction de test me montre les vues retenues pour un gros plan vs un plan large.
```

## Phase 3 — Langage caméra

```
Implémente le langage caméra (PRD §8) :
- type CameraAttrs, libellés FR, pictos SVG simples pour chaque échelle, angle et mouvement
- sélecteur caméra dans la fiche du plan (panneau de droite)
- /lib/camera : formulation générique par valeur + surcharges et flags de capacité par modèle du registre
- alerte sur le plan si le modèle vidéo choisi ne supporte pas le mouvement demandé

Critère : je change l'échelle et le mouvement d'un plan et je vois le prompt final se mettre à jour dans un aperçu.
```

## Phase 4 — Canvas et recettes

```
Implémente le canvas (PRD §9) avec @xyflow/react :
- nodes primitifs : Reference, RefSelector, PromptBuilder, ImageGen, ImageEdit, VideoGen, FrameExtract, Take
- ports typés et colorés par tag de référence
- recettes repliées en un bloc, dépliables : Plan personnage, Plan lieu/ambiance, Plan objet/produit, Continuité, Libre
- exécution : jusqu'à l'image clé par défaut, animation après validation
- bouton variantes ×4, verrou de seed, coût estimé et état du job sur chaque node de génération
- glisser une référence de la bible sur un plan la branche ; bouton « Ajouter à la bible » sur un node Reference local

Critère : PRD §13 point 4 fonctionne de bout en bout.
```

## Phase 5 — Brief digester

```
Implémente le digester (PRD §6) dans /lib/digester et la vue Brief :
- étape diagnostic → niveau 1-4 + manques
- extraction fidèle des niveaux couverts (origin: extracted)
- proposition du premier niveau manquant : 2-3 pistes depuis une idée, une proposition régénérable ensuite (origin: proposed)
- validation par niveau (origin: validated) et descente pas à pas
- au niveau 3, création des références de bible (sans images) ; au niveau 4, création des séquences et plans avec refIds, attributs caméra et recette
- sorties JSON validées par Zod, 1 retry avec l'erreur en cas d'échec
- prompts système en fichiers séparés dans /lib/digester/prompts, faciles à modifier

Teste avec trois briefs : une phrase, un concept d'un paragraphe, un découpage détaillé de 10 plans. Montre-moi les sorties.

Critère : PRD §13 points 1 et 2.
```

## Phase 6 — Storyboard

```
Implémente le storyboard (PRD §10) :
- vues Planche et Timeline
- carte de plan complète (image, pictos, flèche de mouvement en surimpression, statut, coût, badge d'origine)
- carrousel de prises sous chaque carte
- réordonnancement dnd-kit, insertion, découpe, suppression
- vue partagée storyboard / sous-graphe au clic
- remplissage par étapes : génération crayonné de toute une séquence, puis images clés, puis animation
- sélection multiple + modale de confirmation du coût total
- filtres par statut, personnage, lieu
- animatique minimale d'une séquence

Critère : PRD §13 points 6 et 7.
```

## Phase 7 — Coûts, finitions, audit

```
Finalise les coûts (PRD §11) : agrégation par plan, séquence, projet, budget optionnel avec jauge, seuil de confirmation configurable.

Puis fais un audit complet contre PRD §13 : pour chaque critère, dis-moi s'il passe, comment tu l'as vérifié, et corrige ce qui ne passe pas. Vérifie spécifiquement que la clé API n'apparaît dans aucune réponse ni aucun bundle client.
```

---

## Après la V1

```
Lis PRD.md §2 V1.5. Implémente les exports (PDF planche, MP4 animatique via ffmpeg, CSV liste de plans), la piste son temporaire et les alertes de continuité.
```

```
Lis PRD.md §2 V2. Propose une architecture pour les nodes de traitement (depth, masking, remplacement de personnage, relight, étalonnage) en t'appuyant sur les modèles disponibles sur Atlas. Liste les modèles candidats vérifiés avant d'écrire du code.
```

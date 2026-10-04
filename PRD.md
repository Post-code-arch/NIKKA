# NIKKA — Product Requirements Document

> Interface nodale de génération image/vidéo IA pour la préproduction et la production de films, pubs et séries.
> Utilisateur : un seul (fondateur / réalisateur-producteur d'un studio créatif). Application locale, sans comptes.
> Provider unique : **Atlas Cloud** (image, vidéo, LLM via une seule clé API).

---

## 1. Vision

NIKKA transforme un brief, quel que soit son niveau de finition, en film découpé, généré et storyboardé.

Principe fondateur : **un seul graphe de projet, trois vues.**

| Vue | Rôle | Question à laquelle elle répond |
|---|---|---|
| **Brief** | Digérer et structurer l'intention | Qu'est-ce qu'on raconte ? |
| **Canvas** | Fabriquer chaque plan via des recettes nodales | Comment on le fabrique ? |
| **Storyboard** | Piloter le film plan par plan | À quoi ressemble le film ? |

Les trois vues lisent et écrivent les mêmes données. Modifier un plan dans le storyboard modifie son graphe, et inversement.

### Principes produit

1. **Le plan est l'unité de base.** Tout s'organise autour de lui : intention, attributs caméra, workflow, prises.
2. **Itérer = ajouter une prise, jamais écraser.** Chaque génération est conservée et réversible.
3. **Image d'abord, vidéo ensuite.** La cohérence se gagne sur l'image clé (rapide, peu coûteuse), puis on anime.
4. **Recettes haut niveau, dépliables.** L'utilisateur manipule des recettes (« Plan personnage »), pas des paramètres. Une recette s'ouvre pour bidouiller quand un plan résiste.
5. **Traçabilité de l'origine.** Toute info indique si elle vient de l'utilisateur, de l'IA, ou si elle a été validée.
6. **Le coût est visible partout.** Estimé avant de lancer, réel après. C'est un outil de producteur.

---

## 2. Périmètre

### V1 (ce PRD)
- Gestion de projets, séquences, plans, prises.
- **Brief digester** multi-niveaux (diagnostic de maturité, extraction, proposition).
- **Bible** : références partagées (personnages, lieux, objets, look) avec variantes.
- **Canvas nodal** avec recettes dépliables et node Référence tagué.
- **Attributs caméra** par plan (échelle, angle, mouvement, optique) traduits par modèle.
- **Génération** image et vidéo via Atlas, prises, sélection de la prise retenue.
- **Storyboard** : planche + timeline, cartes de plan, carrousel de prises, réordonnancement.
- **Coûts** : estimation, suivi réel, confirmation avant génération par lot.
- **Animatique** minimale (lecture de séquence aux bonnes durées).

### V1.5
- Export PDF de la planche, export MP4 de l'animatique, export CSV de la liste de plans.
- Piste son temporaire dans l'animatique.
- Alertes de continuité (180°, échelles identiques consécutives).

### V2 (hors périmètre, à prévoir dans l'architecture)
- Nodes de traitement : depth map, masking/segmentation, remplacement de personnage, relight, étalonnage / transfert de couleur, upscale.
- Contrôle de cohérence automatique par modèle de vision (score de ressemblance vs référence).
- Entraînement LoRA par personnage (si supporté par Atlas).
- Multi-utilisateurs, partage client.

---

## 3. Architecture technique

### Stack
- **Next.js (App Router) + TypeScript**, exécution locale (`npm run dev` / `npm start`).
- **@xyflow/react** (React Flow) pour le canvas nodal.
- **Zustand** pour l'état client du canvas et du storyboard.
- **SQLite + Drizzle ORM** pour la persistance locale (fichier `./data/nikka.db`).
- **Système de fichiers local** pour les médias (`./storage/assets/`).
- **Tailwind CSS + shadcn/ui** pour l'interface.
- **Zod** pour valider toutes les entrées/sorties (API Atlas, réponses LLM, données du graphe).
- **dnd-kit** pour le réordonnancement du storyboard.
- **openai** (SDK) pointé sur Atlas pour les appels LLM.

### Règles d'architecture
- **La clé API ne quitte jamais le serveur.** `ATLASCLOUD_API_KEY` dans `.env.local`, tous les appels Atlas passent par des route handlers Next (`/api/...`). Aucun appel Atlas depuis le navigateur.
- **Les URLs Atlas sont temporaires.** Tout output (et tout upload) est téléchargé immédiatement dans `./storage/assets/` et référencé localement. On ne stocke jamais une URL Atlas comme source de vérité.
- **Jobs asynchrones côté serveur.** Un poller serveur suit les `prediction_id`, met à jour la base, télécharge les outputs. Le client interroge `/api/jobs` (ou SSE) pour l'état.
- **Registre de modèles.** Les paramètres varient d'un modèle à l'autre (ex. `image` vs `image_url`). Chaque modèle est décrit dans un registre typé qui mappe les entrées génériques de NIKKA vers son schéma propre.

### Structure de dossiers indicative
```
/app
  /(views)/brief, /canvas, /storyboard
  /api/atlas/...        # proxys Atlas
  /api/jobs/...         # état des jobs
  /api/projects/...     # CRUD
/lib
  /atlas                # client, upload, generate, poll, download
  /models               # registre de modèles + adapters
  /camera               # vocabulaire caméra + dictionnaire par modèle
  /recipes              # définitions des recettes
  /digester             # pipeline brief → structure
  /refs                 # sélection de références par plan
  /cost                 # estimation et suivi
/db                     # schéma Drizzle + migrations
/storage/assets         # médias locaux (gitignored)
```

---

## 4. Intégration Atlas Cloud

Authentification : `Authorization: Bearer $ATLASCLOUD_API_KEY`.

| Usage | Méthode | Endpoint |
|---|---|---|
| Génération image (async) | POST | `https://api.atlascloud.ai/api/v1/model/generateImage` |
| Génération vidéo (async) | POST | `https://api.atlascloud.ai/api/v1/model/generateVideo` |
| Suivi d'une prédiction | GET | `https://api.atlascloud.ai/api/v1/model/prediction/{prediction_id}` |
| Upload de média | POST multipart (`file`) | `https://api.atlascloud.ai/api/v1/model/uploadMedia` → `{ url }` |
| LLM (compatible OpenAI) | POST | base URL `https://api.atlascloud.ai/v1` → `/chat/completions` |

**Cycle d'une génération**
1. Si l'entrée est un fichier local → `uploadMedia` → URL temporaire.
2. POST `generateImage` / `generateVideo` avec `{ model, prompt, ...params }` → réponse `{ code, data: { id, status } }`.
3. Poll `prediction/{id}` toutes les 3–5 s (backoff progressif, timeout configurable). Statuts : `created`, `processing`, `completed` / `succeeded`, `failed`.
4. À la complétion : télécharger chaque URL de `outputs[]` dans `./storage/assets/`, créer l'`Asset`, rattacher à la `Take`, enregistrer le coût réel.
5. En cas d'échec : stocker l'erreur sur le job, statut `failed` sur la prise, afficher dans l'UI. Pas de retry automatique (coût).

**Registre de modèles (`/lib/models`)**
Chaque entrée :
```ts
{
  id: string;                 // ex. "vidu/q1/image-to-video"
  label: string;
  kind: "t2i" | "i2i" | "t2v" | "i2v" | "llm";
  maxReferenceImages?: number;// pour les modèles multi-références
  supportsStartEndFrames?: boolean;
  supportsSeed?: boolean;
  durations?: number[];       // vidéo
  resolutions?: string[];
  pricing: { unit: "image" | "second" | "request"; usd: number };
  tier: "sketch" | "draft" | "quality"; // usage par défaut dans NIKKA
  mapInputs: (generic: GenericInputs) => Record<string, unknown>; // adapter vers le schéma du modèle
  camera?: CameraCapabilities; // voir §8
}
```
Les schémas exacts de chaque modèle sont documentés par Atlas dans `https://www.atlascloud.ai/models/{model_id}/llms.txt`. Le registre doit être alimenté en vérifiant ces pages, jamais en devinant.

**Modèles nécessaires en V1** (à identifier dans le catalogue Atlas et vérifier) :
- 1 modèle image rapide et bon marché (tier `sketch`, crayonnés).
- 1 modèle image de qualité texte → image.
- 1 modèle d'édition d'image **multi-références** (le cœur de la cohérence).
- 1 modèle image → vidéo avec image de début (idéalement début + fin).
- 1 LLM pour le digester (et idéalement un LLM avec vision pour la V2).

---

## 5. Modèle de données

```ts
Project {
  id, name, createdAt, updatedAt,
  briefRaw: string,             // texte brut collé par l'utilisateur
  maturity: 1 | 2 | 3 | 4,      // voir §6
  concept: DigestedConcept | null,
  settings: { defaultModels: {...}, budgetUsd?: number }
}

Field<T> { value: T; origin: "extracted" | "proposed" | "validated" }

DigestedConcept {
  pitch: Field<string>, intention: Field<string>,
  tone: Field<string>, audience: Field<string>, format: Field<string>
}

Sequence {
  id, projectId, order, title: Field<string>, summary: Field<string>,
  locationRefId?: string
}

Shot {
  id, sequenceId, order,
  description: Field<string>,   // action
  dialogue?: Field<string>, sound?: Field<string>,
  durationSec: number,
  camera: Field<CameraAttrs>,
  recipeId: string,
  graph: { nodes: Node[]; edges: Edge[] }, // sous-graphe React Flow
  refIds: string[],             // références branchées (locales ou bible)
  framing?: Record<refId, "left" | "center" | "right">, // place des personnages dans le cadre
  selectedTakeId?: string,
  status: "to_write" | "to_generate" | "generating" | "to_review" | "approved"
}

Take {
  id, shotId, stage: "sketch" | "keyframe" | "video",
  assetId?: string, parentTakeId?: string, // ex. la vidéo dérive d'une image clé
  model: string, prompt: string, params: json, seed?: number,
  predictionId?: string, status: "queued" | "processing" | "completed" | "failed",
  costEstimatedUsd: number, costActualUsd?: number, error?: string,
  createdAt
}

Reference {
  id, projectId,
  scope: "bible" | "local",     // bible = partagée, local = propre à un plan
  shotId?: string,              // si local
  tag: "character" | "location" | "object" | "look" | "composition" | "free",
  name: string,
  descriptor: string,           // bloc descriptif figé injecté dans les prompts
  variants: ReferenceVariant[]
}

ReferenceVariant {
  id, name,                     // ex. "Costume de nuit", "Jour", "Blessé"
  views: { assetId: string; view: RefView }[]
}

RefView = "face_front" | "face_34" | "profile" | "full_body" | "expression"
        | "establishing" | "angle_a" | "angle_b" | "detail" | "mood" | "palette" | "untagged"

Asset { id, kind: "image" | "video", path, width, height, durationSec?, sha256, createdAt }

Job { id, takeId, predictionId, endpoint, status, attempts, lastPolledAt, error? }
```

---

## 6. Brief digester

### Échelle de maturité
| Niveau | Nom | Contenu |
|---|---|---|
| 1 | Idée | Une phrase, une intuition |
| 2 | Concept | Pitch, intention, ton, cible, format |
| 3 | Traitement | Direction artistique, entités (personnages, lieux, objets, look), séquences |
| 4 | Découpage | Plans : action, cadrage, mouvement, durée, dialogue, son |

### Comportement
1. **Diagnostic** : le LLM lit `briefRaw` et retourne le niveau atteint + la liste des manques par niveau. L'UI affiche une jauge (« complet jusqu'au niveau 3, découpage manquant »).
2. **Extraction** : pour tous les niveaux couverts par le brief, le LLM extrait fidèlement, sans inventer. Champs marqués `origin: "extracted"`.
3. **Proposition** : pour le premier niveau manquant, le LLM propose.
   - Depuis une idée (niveau 1) : **2 à 3 pistes de concept** distinctes, l'utilisateur en choisit une.
   - Aux niveaux inférieurs : une proposition, régénérable, éditable champ par champ.
   - Champs marqués `origin: "proposed"`.
4. **Descente pas à pas** : après validation d'un niveau (`origin: "validated"`), le digester propose le suivant. C'est une conversation qui descend l'échelle, pas un one-shot.
5. **Câblage automatique** : au niveau 3, les entités sont créées comme `Reference` de la bible (sans images). Au niveau 4, chaque plan est créé avec ses `refIds`, ses attributs caméra et une recette choisie selon son contenu.

### Garde-fous
- Aucun champ `proposed` ne déclenche de génération payante sans validation explicite.
- Sorties LLM en JSON, validées par Zod. En cas d'échec de parsing : 1 retry avec le message d'erreur, puis erreur affichée.
- Le prompt système demande explicitement de distinguer extraction et invention.
- Langue : le digester répond dans la langue du brief (FR, EN, darija transcrite acceptée en entrée).

### UI de la vue Brief
- Zone de saisie du brief (texte collé ; V1.5 : PDF, note vocale).
- Jauge de maturité 1→4.
- Panneaux par niveau, chaque champ avec badge d'origine (couleurs distinctes pour extrait / proposé / validé), éditable inline.
- Boutons : « Valider ce niveau », « Régénérer », « Descendre au niveau suivant ».

---

## 7. Bible et références

### Node « Référence »
Un seul type de node. Il contient une image, plusieurs images, ou une variante d'une référence de bible.
- **Tag** : `character`, `location`, `object`, `look`, `composition`, `free`. Sans tag → `free` (« prends l'ambiance »).
- **Portée** : `local` par défaut. Bouton **« Ajouter à la bible »** pour la promouvoir en référence partagée réutilisable.
- Chaque tag a une couleur de port distincte sur le canvas.
- Une référence de personnage branchée sur un plan porte aussi sa **place dans le cadre** (gauche / centre / droite) et peut porter une note d'action.

### Panneau Bible
- Panneau latéral gauche, accessible dans le canvas et le storyboard.
- Liste des références partagées groupées par tag, avec variantes.
- Glisser une référence (ou une variante) sur un plan la branche.
- Modifier une référence de bible se propage à tous les plans qui l'utilisent (les prises existantes ne sont pas regénérées, mais marquées « référence modifiée depuis »).

### Fabrication d'un pack de référence (assistant)
Pour un personnage : à partir d'une image source ou d'une description, générer les vues standard (`face_front`, `face_34`, `profile`, `full_body`, 2–3 `expression`) sur fond neutre via le modèle d'édition multi-références. L'utilisateur valide chaque vue. Même logique pour un lieu (`establishing`, `angle_a`, `angle_b`) et un look (`mood`, `palette`).

### Sélection automatique des références (`/lib/refs`)
Les modèles multi-références acceptent un nombre limité d'images (`maxReferenceImages`). NIKKA choisit les vues à envoyer selon l'échelle du plan :

| Échelle | Priorité des vues |
|---|---|
| Très gros plan / gros plan | `face_front`, `face_34`, `expression` du personnage ; lieu minimal ou absent |
| Plan rapproché / américain | `face_34`, `full_body` ; 1 vue du lieu |
| Plan moyen / plan large | `full_body` ; `establishing` + 1 angle du lieu |
| Plan d'ensemble | `establishing`, angles du lieu ; personnages en `full_body` seulement |
| Insert | vues `detail` de l'objet |

Règles complémentaires :
- Le `look` prend au plus 1 slot.
- L'angle caméra oriente le choix de vue quand plusieurs existent (contre-plongée → vue la plus proche si taguée).
- Si le budget de slots est dépassé, priorité : personnages > objet clé > lieu > look > libre.
- Le résultat de la sélection est visible et modifiable dans le node dépliable.

### Injection dans les prompts
Le prompt final est assemblé par le node PromptBuilder :
`[descripteurs figés des entités branchées] + [action du plan] + [traduction caméra] + [look]`.
Les descripteurs ne sont jamais réécrits par le LLM à la volée.

---

## 8. Langage caméra

Attribut du plan (`Shot.camera`), choisi par pictos dans la fiche du plan.

```ts
CameraAttrs {
  scale: "extreme_wide" | "wide" | "full" | "medium" | "cowboy" | "medium_close" | "close" | "extreme_close" | "insert";
  angle: "eye_level" | "high" | "low" | "overhead" | "dutch";
  movement: "static" | "pan_left" | "pan_right" | "tilt_up" | "tilt_down"
          | "dolly_in" | "dolly_out" | "truck_left" | "truck_right"
          | "orbit_left" | "orbit_right" | "crane_up" | "crane_down"
          | "drone" | "handheld" | "zoom_in" | "zoom_out" | "dolly_zoom";
  speed?: "slow" | "medium" | "fast";
  lens?: 24 | 35 | 50 | 85 | 135;
  depthOfField?: "deep" | "shallow";
}
```

Libellés UI en français : plan d'ensemble, plan large, plan moyen, plan américain, plan rapproché, gros plan, très gros plan, insert ; plongée, contre-plongée, zénithal, plan cassé ; fixe, panoramique, travelling avant/arrière/latéral, orbite, grue, drone, caméra épaule, zoom, dolly zoom.

### Où ça agit
- `scale`, `angle`, `lens`, `depthOfField` → **image clé** (composition) + sélection des références.
- `movement`, `speed` → **animation** (étape vidéo).

### Dictionnaire par modèle (`/lib/camera`)
- Une formulation générique par défaut pour chaque valeur (en anglais, vocabulaire cinéma standard).
- Des surcharges par modèle quand un modèle comprend mieux une autre formulation ou expose un paramètre dédié (ex. amplitude de mouvement).
- Des **flags de capacité** : si un modèle ne sait pas faire un mouvement, l'UI le signale sur le plan au lieu de produire un résultat aléatoire, et propose un modèle compatible.

---

## 9. Canvas et recettes

### Recettes V1
Une recette est un sous-graphe prédéfini, présenté replié comme un seul bloc. On peut le déplier pour voir et modifier ses nodes internes.

| Recette | Chaîne interne |
|---|---|
| **Plan personnage** | Références → RefSelector → PromptBuilder → ImageEdit (multi-ref) → Take(keyframe) → VideoGen (i2v) → Take(video) |
| **Plan lieu / ambiance** | Références lieu + look → PromptBuilder → ImageGen ou ImageEdit → Take(keyframe) → VideoGen → Take(video) |
| **Plan objet / produit** | Référence objet + look → PromptBuilder → ImageEdit → Take(keyframe) → VideoGen → Take(video) |
| **Continuité** | Dernière frame de la prise retenue du plan précédent → image de début du plan → VideoGen |
| **Libre** | Prompt → n'importe quel modèle → Take |

### Nodes primitifs V1
`Reference`, `RefSelector`, `PromptBuilder`, `ImageGen`, `ImageEdit`, `VideoGen`, `FrameExtract` (dernière/première frame d'une vidéo, via ffmpeg côté serveur), `Take`.
Architecture extensible : un node = `{ type, inputs typés, outputs typés, paramètres, executor serveur }`. Les nodes V2 (depth, mask, swap, relight, color) s'ajouteront sans refonte.

### Comportements
- Chaque plan a son propre sous-graphe. Le canvas global montre la séquence courante ; double-clic sur un plan ouvre son sous-graphe.
- **Exécuter** une recette lance les étapes jusqu'à la première prise à valider (par défaut on s'arrête après l'image clé ; l'animation se lance après validation).
- **Variantes** : bouton « ×4 » sur un node de génération pour lancer N prises avec seeds différents.
- **Verrouiller le seed** pour itérer sur un détail.
- Chaque node de génération affiche le modèle, le coût estimé, et l'état du job.

---

## 10. Storyboard

### Structure et vues
- Hiérarchie : Projet → Séquences → Plans.
- **Planche** : grille de cartes par séquence.
- **Timeline** : plans à leur durée réelle, sur une ligne par séquence.

### Carte de plan
- Image de la prise retenue (la vidéo se lit au survol).
- Numéro (ex. 3.4), durée.
- Pictos échelle + mouvement, et flèche de mouvement dessinée en surimpression sur l'image.
- Action, dialogue/son (tronqués, dépliables).
- Statut, coût (estimé / réel), badge d'origine si le plan est encore `proposed`.
- Sous la carte : carrousel des prises ; cliquer une prise la rend retenue.

### Remplissage par étapes
1. **Planche texte** : cartes créées par le digester, sans image.
2. **Crayonné** : génération de toute la séquence avec un modèle `tier: "sketch"` et un style esquisse imposé, pour juger le découpage à faible coût.
3. **Images clés** : génération qualité, plan par plan ou par séquence.
4. **Animation** : passage en vidéo des plans dont l'image clé est validée.

### Interactions
- Clic sur une carte → vue partagée : storyboard en haut, sous-graphe du plan en bas.
- Glisser-déposer pour réordonner (dnd-kit), insérer un plan entre deux, couper un plan en deux, supprimer.
- Sélection multiple → « Générer la sélection » avec **modale de confirmation du coût total estimé**.
- Filtre par statut, par personnage, par lieu.

### Animatique (V1 minimale)
- Lecture d'une séquence : enchaîne les prises retenues (vidéo, ou image fixe avec léger zoom lent) aux durées des plans.
- V1.5 : piste audio temporaire, export MP4 via ffmpeg.

### Alertes de continuité (V1.5)
- **180°** : dans une séquence, si deux personnages présents dans deux plans consécutifs échangent leur côté (`framing`), alerte.
- **Échelles** : deux plans consécutifs de même échelle sur les mêmes sujets, alerte douce.

---

## 11. Coûts

- Chaque modèle du registre a son tarif Atlas (`pricing`).
- Estimation avant génération : `prix unitaire × (nombre d'images | secondes) × nombre de variantes`.
- Coût réel enregistré à la complétion (V1 : égal à l'estimation ; si Atlas expose le coût réel via son API de billing, l'utiliser).
- Affichage : par prise, par plan (somme), par séquence, par projet. Budget optionnel par projet avec jauge.
- Confirmation obligatoire au-dessus d'un seuil configurable (défaut 2 USD) et pour toute génération par lot.

---

## 12. Design de l'interface

- Thème sombre par défaut, ambiance outil de post-production (fond quasi noir, surfaces gris profond, un accent unique vif).
- Navigation principale : trois onglets **Brief / Canvas / Storyboard** + panneau Bible rétractable à gauche + panneau d'inspection à droite (fiche du plan ou du node sélectionné).
- Typographie : une sans-serif technique pour l'UI, une monospace pour les numéros de plan, durées et coûts.
- Couleurs d'origine : extrait (neutre), proposé (ambre), validé (vert).
- Couleurs de tags de référence cohérentes entre canvas, bible et storyboard.
- Desktop d'abord (usage en studio). Pas de mobile en V1.

---

## 13. Critères d'acceptation V1

1. Je colle une idée d'une phrase, j'obtiens 2–3 pistes, j'en valide une, je descends jusqu'au découpage et j'obtiens un storyboard texte avec séquences et plans.
2. Je colle un découpage détaillé existant, NIKKA le reconnaît niveau 4 et l'extrait sans inventer.
3. Je crée un personnage dans la bible avec son pack de vues, je le branche sur 5 plans d'échelles différentes, et les références envoyées diffèrent selon l'échelle.
4. Je génère l'image clé d'un plan, puis 4 variantes, je choisis une prise, je l'anime en vidéo avec un travelling avant lent.
5. Toutes les prises sont conservées et récupérables ; les médias sont stockés localement et lisibles même si les URLs Atlas expirent.
6. Je vois le coût estimé avant chaque génération et le coût cumulé du projet.
7. Je réordonne les plans dans la planche, je passe en timeline, je lis l'animatique d'une séquence.
8. La clé API n'apparaît jamais côté client (vérifiable dans le réseau du navigateur).

---

## 14. Questions ouvertes (à vérifier pendant le build)

- Quels modèles Atlas acceptent plusieurs images de référence en entrée, et combien ?
- Quels modèles image → vidéo acceptent image de début **et** de fin ?
- Atlas expose-t-il un LLM avec entrée image (nécessaire pour le contrôle de cohérence V2) ?
- Atlas expose-t-il le coût réel par prédiction via API ?
- Formats d'entrée exacts (`image` vs `image_url`, base64 accepté ou non) pour chaque modèle retenu.

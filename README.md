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

## Organisation

- `lib/atlas` — client Atlas côté serveur uniquement : upload, génération, polling (backoff + timeout), téléchargement dans `storage/assets/<sha256>.<ext>`, catalogue et schémas d'entrée des modèles, LLM (SDK `openai`), mode mock.
- `db` — schéma Drizzle (PRD §5) et migrations SQLite, base dans `data/nikka.db`.
- `lib/models` — registre de modèles et adapters `mapInputs`. Les modèles Atlas réels ne sont ajoutés qu'après validation.
- `lib/generation`, `lib/jobs` — création des prises (jamais d'écrasement, coût confirmé au-dessus du seuil) et poller serveur qui télécharge les sorties dès la complétion.
- `app/api` — routes CRUD projets / séquences / plans / références, génération, `/api/jobs`, `/api/assets/:id`.
- `storage/assets`, `data` — médias et base locale (non versionnés).

Avancement par phases : voir `PROMPTS.md`.

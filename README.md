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
| `npm run atlas:smoke` | Smoke test réel : 1 appel LLM, 1 texte → image (modèle image le moins cher du catalogue), 1 image → vidéo. Coût estimé affiché, arrêt si > `NIKKA_SMOKE_MAX_USD` (0,5 $ par défaut) |
| `npm run typecheck` / `npm run lint` / `npm test` | Vérifications |

## Organisation

- `lib/atlas` — client Atlas côté serveur uniquement : upload, génération, polling (backoff + timeout), téléchargement dans `storage/assets/<sha256>.<ext>`, catalogue et schémas d'entrée des modèles, LLM (SDK `openai`), mode mock.
- `storage/assets`, `data` — médias et base locale (non versionnés).

Avancement par phases : voir `PROMPTS.md`.

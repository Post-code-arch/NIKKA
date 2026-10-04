# NIKKA — instructions pour Claude Code

Lis `PRD.md` en entier avant toute tâche. C'est la source de vérité du produit.
Suis `PROMPTS.md` phase par phase : ne commence pas une phase tant que la précédente ne passe pas ses critères.

## Contexte
- App locale, un seul utilisateur, pas d'authentification.
- Provider unique : Atlas Cloud. Clé dans `.env.local` → `ATLASCLOUD_API_KEY`.
- Interface en français. Code, noms de variables et commits en anglais.

## Outils Atlas recommandés dans cette session
```bash
npx skills add AtlasCloudAI/atlas-cloud-skills
claude mcp add atlascloud -- npx -y atlascloud-mcp
```
Pour le schéma exact d'un modèle : `https://www.atlascloud.ai/models/{model_id}/llms.txt`.
Ne jamais deviner un nom de paramètre ou un ID de modèle : vérifier.

## Règles non négociables
1. Aucun appel Atlas depuis le navigateur. Tout passe par des route handlers serveur.
2. Tout output Atlas est téléchargé dans `./storage/assets/` dès la complétion. Les URLs Atlas sont temporaires.
3. Ne jamais écraser une prise : toujours créer une nouvelle `Take`.
4. Toute réponse LLM et toute réponse Atlas est validée par Zod.
5. Aucune génération payante ne part sans affichage du coût estimé ; confirmation obligatoire au-dessus du seuil.
6. Pas de retry automatique sur une génération échouée (coût).
7. Les descripteurs de références (`Reference.descriptor`) sont injectés tels quels, jamais réécrits par un LLM.

## Stack
Next.js App Router + TypeScript strict, @xyflow/react, Zustand, SQLite + Drizzle, Tailwind + shadcn/ui, Zod, dnd-kit, SDK `openai` avec `baseURL: "https://api.atlascloud.ai/v1"`, ffmpeg (côté serveur) pour l'extraction de frames.

## Conventions
- Logique Atlas isolée dans `/lib/atlas`, jamais dans les composants.
- Chaque modèle passe par le registre `/lib/models` et son adapter `mapInputs`.
- Pour tester sans dépenser : variable `NIKKA_MOCK_ATLAS=1` qui renvoie des images/vidéos factices locales avec délai simulé. Toute fonctionnalité doit marcher en mode mock.
- Après chaque phase : lancer le typecheck et le lint, corriger, puis résumer ce qui a été fait et ce qui reste.

## Next.js
Next.js 16 : voir `AGENTS.md` et la doc locale `node_modules/next/dist/docs/` avant d'écrire du code Next.

# NIKKA — direction visuelle

Référence : `reference-ui.jpg` (éditeur nodal sombre, panneaux flottants). Elle précise PRD §12.

## Principes
- **Tout flotte sur le canvas.** Fond quasi noir avec grille de points. Les barres d'outils, les docks et les nodes sont des îlots arrondis posés dessus, sans barre pleine largeur.
- **Neutre d'abord.** Les surfaces sont en gris profonds, le texte en blanc cassé ou en gris. La couleur n'apparaît qu'aux endroits porteurs de sens : ports et tags de référence, badges d'origine, états de job.
- **Un seul bouton plein, blanc**, pour l'action principale de l'écran (« Générer », « Valider »). Tout le reste est en pilules sombres.
- **Lueur = focus.** Un node sélectionné ou en cours de génération émet un halo diffus de la couleur de son type.
- **Typo** : sans-serif pour l'UI, en petit corps (11–13 px). Monospace pour les numéros de plan, les durées, les coûts, les seeds et les stats de coin.

## Anatomie
| Zone | Contenu NIKKA |
|---|---|
| Barre haute gauche | Logo + pilules de vue : Brief / Canvas / Storyboard |
| Barre haute centre | Sélecteur de projet `‹ [Projet ×] ›`, sous-titre séquence/plan |
| Barre haute droite | File de jobs (pilule ▶ + compteur), coût projet (mono), menu |
| Bord droit | Dock vertical : zoom +/−, ajuster, grille, recentrer |
| Bas centre | Dock de prompt / action contextuelle avec rangée d'icônes |
| Coins bas | Stats mono : coût estimé, nb de plans, prises, jobs actifs |
| Gauche (rétractable) | Panneau Bible |

## Node
- L'en-tête est **au-dessus** de la carte : icône ✱ + titre en petit. Un chip d'action optionnel s'affiche à droite (ex. « Générer » en vert).
- La carte est un rayon de 14 px en `surface`, avec une bordure de 1 px à 6 % de blanc et un panneau intérieur en `surface-2`.
- Les ports sont des pastilles de 6 px, colorées par type, et alignées sur le libellé du champ.
- Les champs suivent le schéma « libellé gris à gauche, contrôle en pilule sombre à droite ». Le stepper ‹ 30 › sert aux valeurs numériques.
- Les liens sont des courbes fines en gris clair, sans flèche.

Les tokens sont dans `app/globals.css`, les primitives dans `components/ui/*` et `components/nodes/*`.

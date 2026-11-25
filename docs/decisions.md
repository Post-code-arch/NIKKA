# Décisions produit (écarts au PRD)

## 2026-11-25 — Un seul canvas par projet, 6 nodes (remplace « canvas libre par plan »)

Demande du fondateur : des nodes indépendants des séquences, avec une liaison possible au storyboard.
- **Un seul grand canvas par projet** (`projects.canvas`), sans lien obligatoire avec une séquence ou un plan.
- **Six nodes seulement** : Texte, Image, Vidéo (entrées), Texte → image, Texte → vidéo, Image → vidéo (générateurs). Les autres nodes (Référence, Prompt du plan, Sélection des vues, Extraction, Prise du plan, édition multi-réf) et les modèles de recettes sont supprimés du canvas ; ils restent dans la voie Storyboard.
- Les résultats (`node_runs`) appartiennent au projet. **« Envoyer au plan… »** (optionnel) choisit n'importe quel plan du projet ; le résultat y devient une prise (coût compté une seule fois, sur le résultat).
- Migration : les résultats des anciens canvas par plan sont rattachés à leur projet ; les anciens graphes par plan ne sont plus affichés.


## 2026-11-25 — Canvas libre par plan (PRD §1, §9) — remplacé, voir ci-dessus

Le PRD prévoyait « un seul graphe, trois vues » : le Canvas montrait le même graphe de recette que le Storyboard. À l'usage, le Canvas doublait les fonctions du Storyboard.

Décision (demande du fondateur) :
- **Storyboard** = voie rigide : fiche du plan, Image clé, Animer, prises.
- **Canvas** = **un canvas nodal libre par plan**, vide au départ, construit par l'utilisateur.
- Les résultats du canvas (`node_runs`) **restent dans le canvas**. Le bouton **« Envoyer au plan »** en fait une prise du storyboard (le coût reste compté une seule fois, sur le résultat).
- Le canvas peut **lire** le storyboard et la bible : node « Prise du plan » (prise retenue), « Prompt du plan » (descripteurs + action + caméra), références de la bible.
- Les **recettes** deviennent des **modèles insérables** dans le canvas, modifiables ensuite.

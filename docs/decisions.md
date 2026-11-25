# Décisions produit (écarts au PRD)

## 2026-11-25 — Canvas libre par plan (PRD §1, §9)

Le PRD prévoyait « un seul graphe, trois vues » : le Canvas montrait le même graphe de recette que le Storyboard. À l'usage, le Canvas doublait les fonctions du Storyboard.

Décision (demande du fondateur) :
- **Storyboard** = voie rigide : fiche du plan, Image clé, Animer, prises.
- **Canvas** = **un canvas nodal libre par plan**, vide au départ, construit par l'utilisateur.
- Les résultats du canvas (`node_runs`) **restent dans le canvas**. Le bouton **« Envoyer au plan »** en fait une prise du storyboard (le coût reste compté une seule fois, sur le résultat).
- Le canvas peut **lire** le storyboard et la bible : node « Prise du plan » (prise retenue), « Prompt du plan » (descripteurs + action + caméra), références de la bible.
- Les **recettes** deviennent des **modèles insérables** dans le canvas, modifiables ensuite.

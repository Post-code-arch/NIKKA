# Sorties du digester sur les trois briefs de test (mode mock)

Généré par `lib/digester/samples.gen.test.ts`. En mode mock, l'extraction est faite par des règles (fidèle, sans invention) et les propositions sont des gabarits marqués [mock]. Avec le vrai LLM, mêmes schémas et mêmes étapes.

## Une phrase

> Une femme attend sur un quai un train qui ne vient jamais.

**Diagnostic** : niveau 1 — Complet jusqu'au niveau 1, concept manquant

**Idée** (extracted) : Une femme attend sur un quai un train qui ne vient jamais.

**Pistes proposées** :
- *Intime* — [mock] Une femme attend sur un quai un train qui ne vient jamais, raconté au plus près d'un personnage. (tendre, contemplatif · court-métrage 2 min)
- *Spectaculaire* — [mock] Une femme attend sur un quai un train qui ne vient jamais, raconté par l'image et le mouvement. (épique, rythmé · film 60 s)
- *Décalé* — [mock] Une femme attend sur un quai un train qui ne vient jamais, raconté par un détournement. (drôle, inattendu · spot 30 s)

**Traitement** — direction artistique (extracted) : —

Entités :
- Quai [location] (extracted) : —

## Un concept d'un paragraphe

> Un film de 60 secondes pour une marque de thé marocaine. On veut montrer le rituel du thé comme un moment de pause dans une ville qui va trop vite. Le ton est poétique et chaleureux, avec un peu d'humour. Public : jeunes actifs urbains de 25 à 35 ans, diffusion sur Instagram et YouTube.

**Diagnostic** : niveau 2 — Complet jusqu'au niveau 2, traitement manquant

**Idée** (extracted) : Un film de 60 secondes pour une marque de thé marocaine.

**Concept** :
- pitch (extracted) : Un film de 60 secondes pour une marque de thé marocaine.
- intention (extracted) : On veut montrer le rituel du thé comme un moment de pause dans une ville qui va trop vite.
- tone (extracted) : Le ton est poétique et chaleureux, avec un peu d'humour.
- audience (extracted) : Public : jeunes actifs urbains de 25 à 35 ans, diffusion sur Instagram et YouTube.
- format (extracted) : 60 secondes

**Traitement** — direction artistique (proposed) : [mock] Lumière naturelle rasante, palette chaude, grain léger.

Entités :
- Héroïne [character] (proposed) : [mock] Trentaine, manteau long, regard calme.
- Lieu principal [location] (proposed) : [mock] Lieu ouvert, matières brutes, lumière de fin de journée.
- Look [look] (proposed) : [mock] Pellicule 35 mm, contrastes doux.

Séquences :
- Ouverture (proposed) : [mock] Ouverture : Héroïne, étape 1 de l'histoire.
- Rencontre (proposed) : [mock] Rencontre : Héroïne, étape 2 de l'histoire.
- Bascule (proposed) : [mock] Bascule : Héroïne, étape 3 de l'histoire.
- Résolution (proposed) : [mock] Résolution : Héroïne, étape 4 de l'histoire.

## Un découpage de 10 plans

> Séquence 1 — Le quai
> Plan 1 : Plan d'ensemble du quai désert à l'aube, plan fixe. (5s)
> Plan 2 : Lina, manteau rouge, entre dans le champ. Plan large, travelling latéral lent. (4s)
> Plan 3 : Gros plan sur le visage de Lina qui regarde l'horloge. (3s)
> Plan 4 : Insert sur l'horloge de la gare, aiguilles immobiles. (2s)
> Plan 5 : Plan taille de Lina, elle s'assoit sur le banc. Son : vent, mouettes. (4s)
> Séquence 2 — L'attente
> Plan 6 : Plongée sur Lina seule sur le banc, panoramique vers la gauche. (5s)
> Plan 7 : Plan rapproché, Lina murmure « Il viendra ». (3s)
> Plan 8 : Très gros plan sur ses mains qui serrent un billet. (2s)
> Plan 9 : Contre-plongée sur le panneau des départs qui clignote. Zoom avant. (3s)
> Plan 10 : Plan d'ensemble au drone, le quai se vide, Lina reste. (6s)

**Diagnostic** : niveau 4 — Complet jusqu'au découpage

**Idée** (extracted) : Plan d'ensemble du quai désert à l'aube, plan fixe.

**Traitement** — direction artistique (extracted) : —

Entités :
- Lina [character] (extracted) : Lina, manteau rouge, entre dans le champ. Plan large, travelling latéral lent.
- Quai [location] (extracted) : —
- Gare [location] (extracted) : —

Séquences :
- Le quai (extracted) : —
- L'attente (extracted) : —

**Découpage** :

| Plan | Action | Échelle | Angle | Mouvement | Durée | Dialogue / son | Réfs | Origine |
|---|---|---|---|---|---|---|---|---|
| 1.1 | Plan d'ensemble du quai désert à l'aube, plan fixe. | Plan d'ensemble | À hauteur d'yeux | Fixe | 5s | — | Quai | extracted |
| 1.2 | Lina, manteau rouge, entre dans le champ. Plan large, travelling latéral lent. | Plan large | À hauteur d'yeux | Travelling latéral droite (slow) | 4s | — | Lina | extracted |
| 1.3 | Gros plan sur le visage de Lina qui regarde l'horloge. | Gros plan | À hauteur d'yeux | Fixe | 3s | — | Lina | extracted |
| 1.4 | Insert sur l'horloge de la gare, aiguilles immobiles. | Insert | À hauteur d'yeux | Fixe | 2s | — | Gare | extracted |
| 1.5 | Plan taille de Lina, elle s'assoit sur le banc. Son : vent, mouettes. | Plan taille | À hauteur d'yeux | Fixe | 4s | son : vent, mouettes | Lina | extracted |
| 2.1 | Plongée sur Lina seule sur le banc, panoramique vers la gauche. | Plan taille | Plongée | Panoramique gauche | 5s | — | Lina | extracted |
| 2.2 | Plan rapproché, Lina murmure « Il viendra ». | Plan rapproché | À hauteur d'yeux | Fixe | 3s | « Il viendra » | Lina | extracted |
| 2.3 | Très gros plan sur ses mains qui serrent un billet. | Très gros plan | À hauteur d'yeux | Fixe | 2s | — | — | extracted |
| 2.4 | Contre-plongée sur le panneau des départs qui clignote. Zoom avant. | Plan taille | Contre-plongée | Zoom avant | 3s | — | — | extracted |
| 2.5 | Plan d'ensemble au drone, le quai se vide, Lina reste. | Plan d'ensemble | À hauteur d'yeux | Drone | 6s | — | Lina, Quai | extracted |


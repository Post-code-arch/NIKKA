import type { NodeType } from "@/lib/graph/types";

/**
 * One key per node (canvas focused, not typing). With one node selected,
 * the new node is placed next to it and linked to it when their ports match,
 * so T → 1 → 3 builds texte → image → vidéo in three keystrokes.
 */
export const NODE_SHORTCUTS: Record<NodeType, string> = {
  text: "T",
  image: "I",
  video: "V",
  reference: "R",
  negative: "N",
  promptEnhancer: "E",
  textToImage: "1",
  textToVideo: "2",
  imageToVideo: "3",
  videoToVideo: "4",
  referenceToVideo: "5",
};

export const NODE_BY_KEY: Record<string, NodeType> = Object.fromEntries(
  Object.entries(NODE_SHORTCUTS).map(([type, key]) => [key.toLowerCase(), type as NodeType]),
);

/** Every canvas shortcut, for the help panel. */
export const CANVAS_SHORTCUTS: [string, string][] = [
  ["Tab  ou  /", "Recherche rapide d'un node, à l'endroit de la souris"],
  ["T  I  V  R  N  E", "Texte · Image · Vidéo · Référence · Négatif · Prompt enhancer"],
  ["1  2  3  4  5", "Texte → image · Texte → vidéo · Image → vidéo · Vidéo → vidéo · Références → vidéo"],
  ["(un node sélectionné)", "le nouveau node se place à côté et se branche dessus"],
  ["Double-clic", "Ajouter un node à cet endroit"],
  ["Clic droit + glisser", "Sélectionner une zone (Ctrl+clic sur Mac, Maj pour ajouter)"],
  ["Clic droit", "Menu : ajouter, tout sélectionner, dupliquer, supprimer"],
  ["⌘/Ctrl + Z", "Annuler"],
  ["⌘/Ctrl + ⇧ + Z  ·  Ctrl + Y", "Rétablir"],
  ["⌘/Ctrl + A", "Tout sélectionner"],
  ["⌘/Ctrl + D", "Dupliquer la sélection"],
  ["Suppr", "Supprimer la sélection"],
  ["Échap", "Désélectionner / fermer"],
  ["?", "Afficher ces raccourcis"],
];

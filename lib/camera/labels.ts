import type { CameraAttrs } from "./types";

/** French UI labels (PRD §8). Icons and per-model wording come in phase 3. */
export const SCALE_LABEL: Record<CameraAttrs["scale"], string> = {
  extreme_wide: "Plan d'ensemble",
  wide: "Plan large",
  full: "Plan moyen",
  medium: "Plan taille",
  cowboy: "Plan américain",
  medium_close: "Plan rapproché",
  close: "Gros plan",
  extreme_close: "Très gros plan",
  insert: "Insert",
};

export const ANGLE_LABEL: Record<CameraAttrs["angle"], string> = {
  eye_level: "À hauteur d'yeux",
  high: "Plongée",
  low: "Contre-plongée",
  overhead: "Zénithal",
  dutch: "Plan cassé",
};

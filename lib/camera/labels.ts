import type { CameraAttrs } from "./types";

/** French UI labels (PRD §8). */
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

export const MOVEMENT_LABEL: Record<CameraAttrs["movement"], string> = {
  static: "Fixe",
  pan_left: "Panoramique gauche",
  pan_right: "Panoramique droite",
  tilt_up: "Panoramique haut",
  tilt_down: "Panoramique bas",
  dolly_in: "Travelling avant",
  dolly_out: "Travelling arrière",
  truck_left: "Travelling latéral gauche",
  truck_right: "Travelling latéral droite",
  orbit_left: "Orbite gauche",
  orbit_right: "Orbite droite",
  crane_up: "Grue montante",
  crane_down: "Grue descendante",
  drone: "Drone",
  handheld: "Caméra épaule",
  zoom_in: "Zoom avant",
  zoom_out: "Zoom arrière",
  dolly_zoom: "Dolly zoom",
};

export const SPEED_LABEL: Record<NonNullable<CameraAttrs["speed"]>, string> = {
  slow: "Lent",
  medium: "Moyen",
  fast: "Rapide",
};

export const LENS_LABEL: Record<NonNullable<CameraAttrs["lens"]>, string> = {
  24: "24 mm",
  35: "35 mm",
  50: "50 mm",
  85: "85 mm",
  135: "135 mm",
};

export const DOF_LABEL: Record<NonNullable<CameraAttrs["depthOfField"]>, string> = {
  deep: "Grande profondeur",
  shallow: "Faible profondeur",
};

export const SCALE_ORDER: CameraAttrs["scale"][] = [
  "extreme_wide", "wide", "full", "medium", "cowboy", "medium_close", "close", "extreme_close", "insert",
];
export const ANGLE_ORDER: CameraAttrs["angle"][] = ["eye_level", "high", "low", "overhead", "dutch"];
export const MOVEMENT_ORDER: CameraAttrs["movement"][] = [
  "static", "pan_left", "pan_right", "tilt_up", "tilt_down",
  "dolly_in", "dolly_out", "truck_left", "truck_right",
  "orbit_left", "orbit_right", "crane_up", "crane_down",
  "zoom_in", "zoom_out", "dolly_zoom", "handheld", "drone",
];

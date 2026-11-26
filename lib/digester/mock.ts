import type { DigestTask } from "./llm";

/**
 * Mock digester (NIKKA_MOCK_ATLAS=1): no LLM, nothing billed. Rule-based
 * reading of the brief, good enough to exercise the whole flow. Extraction
 * stays faithful (it only copies what it finds); proposals are templates
 * marked "[mock]".
 */

type Scale = "extreme_wide" | "wide" | "full" | "medium" | "cowboy" | "medium_close" | "close" | "extreme_close" | "insert";

const SCALE_WORDS: [RegExp, Scale][] = [
  [/tr[eè]s gros plan|extreme close|\becu\b|macro/i, "extreme_close"],
  [/gros plan|close[- ]?up|\bcu\b/i, "close"],
  [/plan rapproch[ée]|medium close|\bmcu\b/i, "medium_close"],
  [/plan am[ée]ricain|cowboy/i, "cowboy"],
  [/plan d'ensemble|plan g[ée]n[ée]ral|extreme wide|establishing|\bews\b/i, "extreme_wide"],
  [/plan large|wide shot|\bwide\b|\bws\b/i, "wide"],
  [/plan moyen|plein pied|en pied|full shot/i, "full"],
  [/plan taille|medium shot|\bms\b|mi-corps/i, "medium"],
  [/\binsert\b/i, "insert"],
];
const MOVE_WORDS: [RegExp, string][] = [
  [/travelling avant|dolly in|push[- ]in/i, "dolly_in"],
  [/travelling arri[eè]re|dolly out|pull[- ]out|pull back/i, "dolly_out"],
  [/travelling lat[ée]ral gauche|truck left/i, "truck_left"],
  [/travelling lat[ée]ral|travelling|tracking|truck right/i, "truck_right"],
  [/panoramique (?:vers la )?gauche|pan left/i, "pan_left"],
  [/panoramique (?:vers le )?haut|tilt up/i, "tilt_up"],
  [/panoramique (?:vers le )?bas|tilt down/i, "tilt_down"],
  [/panoramique|pan right|\bpan\b/i, "pan_right"],
  [/orbite|orbit|tourne autour/i, "orbit_right"],
  [/grue descendante|crane down/i, "crane_down"],
  [/grue|crane/i, "crane_up"],
  [/drone|a[ée]rien|aerial/i, "drone"],
  [/[ée]paule|handheld|cam[ée]ra port[ée]e/i, "handheld"],
  [/zoom arri[eè]re|zoom out/i, "zoom_out"],
  [/zoom avant|zoom in|\bzoom\b/i, "zoom_in"],
  [/plan fixe|\bfixe\b|static/i, "static"],
];
const ANGLE_WORDS: [RegExp, string][] = [
  [/contre[- ]plong[ée]e|low angle/i, "low"],
  [/plong[ée]e|high angle/i, "high"],
  [/z[ée]nith|overhead|top shot|vue du dessus/i, "overhead"],
  [/plan cass[ée]|dutch/i, "dutch"],
];

const first = <T>(list: [RegExp, T][], s: string) => list.find(([re]) => re.test(s))?.[1];

function language(brief: string): "fr" | "en" {
  const fr = (brief.match(/\b(le|la|les|des|une|et|est|dans|sur|avec|qui)\b|[éèàç]/gi) ?? []).length;
  const en = (brief.match(/\b(the|and|is|with|of|in|on|who|her|his)\b/gi) ?? []).length;
  return en > fr ? "en" : "fr";
}

function sentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const SHOT_LINE = /^\s*(?:plan|shot|p)\s*\.?\s*(\d+)\s*[:.\-–—)]?\s*(.*)$/i;
const SEQ_LINE = /^\s*(?:s[ée]quence|seq\.?|sc[eè]ne|scene)\s*(\d*)\s*[:.\-–—]?\s*(.*)$/i;

interface ParsedShot {
  text: string;
}
interface ParsedSeq {
  title: string;
  body: string[];
  shots: ParsedShot[];
}

function parseStructure(brief: string) {
  const seqs: ParsedSeq[] = [];
  let current: ParsedSeq | null = null;
  let shot: ParsedShot | null = null;
  for (const line of brief.split(/\r?\n/)) {
    const seq = line.match(SEQ_LINE);
    const sh = line.match(SHOT_LINE);
    if (seq && !sh) {
      current = { title: seq[2].trim() || `Séquence ${seq[1] || seqs.length + 1}`, body: [], shots: [] };
      seqs.push(current);
      shot = null;
    } else if (sh) {
      if (!current) {
        current = { title: "", body: [], shots: [] };
        seqs.push(current);
      }
      shot = { text: sh[2].trim() };
      current.shots.push(shot);
    } else if (line.trim()) {
      if (shot) shot.text += ` ${line.trim()}`;
      else current?.body.push(line.trim());
    }
  }
  return seqs;
}

const STOP = new Set(
  "Plan Plans Gros Très Séquence Sequence Scène Scene Shot Le La Les Un Une Des Et Dans Sur Avec Elle Il Ils Elles On Nous Puis Son Sa Ses Leur The A An And In On With She He They Her His Then Travelling Panoramique Fixe Insert Contre Plongée Zoom Caméra Camera Lumière Dialogue Son Sound Voix Off Musique Fin Ouverture Ensuite Pendant Quand Alors Close Wide Medium Public Instagram YouTube TikTok Facebook Diffusion Format Cible".split(
    " ",
  ),
);
const PLACE = /\b(quai|gare|rue|ruelle|appartement|cuisine|chambre|for[eê]t|plage|caf[ée]|bar|bureau|toit|port|march[ée]|montagne|usine|atelier|street|beach|forest|kitchen|rooftop|station|market|harbou?r)\b/gi;

function names(text: string): string[] {
  const out = new Map<string, number>();
  for (const s of sentences(text)) {
    const words = s.split(/\s+/);
    words.forEach((w, i) => {
      const clean = w.replace(/[^\p{L}'-]/gu, "");
      if (i === 0 || clean.length < 3 || !/^\p{Lu}\p{Ll}/u.test(clean) || STOP.has(clean)) return;
      // Camera vocabulary is not a name.
      if ([...SCALE_WORDS, ...MOVE_WORDS, ...ANGLE_WORDS].some(([re]) => re.test(clean))) return;
      out.set(clean, (out.get(clean) ?? 0) + 1);
    });
  }
  return [...out.keys()].slice(0, 5);
}

function places(text: string): string[] {
  const found = new Set((text.match(PLACE) ?? []).map((p) => p.toLowerCase()));
  return [...found].slice(0, 3).map((p) => p[0].toUpperCase() + p.slice(1));
}

function shotOf(text: string, entityNames: string[]) {
  const duration = text.match(/(\d+(?:[.,]\d+)?)\s*(?:s|sec|secondes?|seconds?)\b/i);
  const dialogue = text.match(/[«"“]\s*([^»"”]+?)\s*[»"”]/);
  const sound = text.match(/(?:son|sound|sfx)\s*:\s*([^.;]+)/i);
  const speed = /\blent|slow/i.test(text) ? "slow" : /rapide|fast/i.test(text) ? "fast" : undefined;
  return {
    description: text.replace(/\(\s*\d+(?:[.,]\d+)?\s*(?:s|sec|secondes?|seconds?)\s*\)/i, "").trim(),
    ...(dialogue ? { dialogue: dialogue[1] } : {}),
    ...(sound ? { sound: sound[1].trim() } : {}),
    durationSec: duration ? Math.min(60, Number(duration[1].replace(",", "."))) : 4,
    camera: {
      scale: first(SCALE_WORDS, text) ?? "medium",
      angle: first(ANGLE_WORDS, text) ?? "eye_level",
      movement: first(MOVE_WORDS, text) ?? "static",
      ...(speed ? { speed } : {}),
    },
    refs: entityNames.filter((n) => text.toLowerCase().includes(n.toLowerCase())),
  };
}

function diagnose(brief: string) {
  const seqs = parseStructure(brief);
  const shots = seqs.reduce((n, s) => n + s.shots.length, 0);
  const words = brief.split(/\s+/).filter(Boolean).length;
  const headings = seqs.filter((s) => s.title).length;
  const level = shots >= 2 ? 4 : headings >= 2 || (names(brief).length >= 2 && words > 120) ? 3 : words >= 25 ? 2 : 1;
  const fr = language(brief) === "fr";
  const missing = (n: number) => (level >= n ? [] : null);
  return {
    level,
    language: language(brief),
    summary: fr
      ? level === 4 ? "Complet jusqu'au découpage" : `Complet jusqu'au niveau ${level}, ${["", "concept", "traitement", "découpage"][level]} manquant`
      : level === 4 ? "Complete down to the breakdown" : `Complete up to level ${level}, ${["", "concept", "treatment", "breakdown"][level]} missing`,
    gaps: {
      concept: missing(2) ?? (fr ? ["pitch", "intention", "ton", "cible", "format"] : ["pitch", "intention", "tone", "audience", "format"]),
      treatment: missing(3) ?? (fr ? ["direction artistique", "personnages et lieux", "séquences"] : ["art direction", "characters and places", "sequences"]),
      breakdown: missing(4) ?? (fr ? ["plans : cadrage, mouvement, durée"] : ["shots: framing, movement, duration"]),
    },
  };
}

function pick(list: string[], re: RegExp) {
  return list.find((s) => re.test(s)) ?? "";
}

/** Free text of the brief, outside sequence headings and shot lines. */
function prose(brief: string) {
  const seqs = parseStructure(brief);
  const intro = brief.split(/\r?\n/).filter((l) => l.trim() && !SEQ_LINE.test(l) && !SHOT_LINE.test(l));
  return seqs.some((s) => s.shots.length) ? intro.filter((l) => !seqs.some((s) => s.shots.some((sh) => sh.text.includes(l.trim())))).join(" ") : brief;
}

function extract(brief: string, level: number) {
  const free = prose(brief);
  const all = sentences(free);
  const seqs = parseStructure(brief);
  const shotTexts = seqs.flatMap((s) => s.shots.map((sh) => sh.text));
  const people = names(brief);
  const where = places(brief);
  const entities = [
    ...people.map((name) => ({
      name,
      tag: "character" as const,
      // What the brief says about them, where it first names them.
      descriptor: (pick(all, new RegExp(`\\b${name}\\b`)) || shotTexts.find((t) => t.includes(name)) || "").replace(/\(\s*\d+(?:[.,]\d+)?\s*s\w*\s*\)/gi, "").trim(),
    })),
    ...where.map((name) => ({ name, tag: "location" as const, descriptor: "" })),
  ];
  const entityNames = entities.map((e) => e.name);
  const format = free.match(/\b(\d+\s*(?:s|sec|secondes|min|minutes)\b|spot|clip|court[- ]m[ée]trage|publicit[ée]|teaser|s[ée]rie|documentaire|short film|commercial)/i)?.[0] ?? "";
  return {
    idea: all[0] ?? shotTexts[0]?.replace(/\(\s*\d+(?:[.,]\d+)?\s*s\w*\s*\)/gi, "").trim() ?? brief.trim(),
    concept:
      level >= 2 && all.length > 0
        ? {
            pitch: all[0] ?? "",
            intention: pick(all.slice(1), /\b(pour|afin|veut|montrer|raconter|want|to show|intention)\b/i),
            tone: pick(all, /\b(ton|ambiance|po[ée]tique|sombre|dr[ôo]le|m[ée]lancolique|[ée]nergique|onirique|tendre|tone|mood)\b/i),
            audience: pick(all, /\b(public|cible|jeunes|adultes|enfants|audience|target)\b/i),
            format,
          }
        : null,
    treatment:
      level >= 3 || entities.length > 0
        ? {
            artDirection: pick(all, /\b(lumi[eè]re|couleurs?|palette|esth[ée]tique|grain|light|colou?rs?|look)\b/i),
            entities,
            sequences: seqs
              .filter((s) => s.title)
              .map((s) => ({ title: s.title, summary: s.body.join(" ") })),
          }
        : null,
    breakdown:
      level >= 4
        ? {
            sequences: seqs
              .filter((s) => s.shots.length)
              .map((s, i) => ({
                title: s.title || (language(brief) === "fr" ? `Séquence ${i + 1}` : `Sequence ${i + 1}`),
                summary: s.body.join(" "),
                shots: s.shots.map((sh) => shotOf(sh.text, entityNames)),
              })),
          }
        : null,
  };
}

interface Ctx {
  idea?: { value: string };
  concept?: Record<string, { value: string }>;
  treatment?: { entities: { name: string; tag: string }[]; sequences: { title: string; summary: string; location?: string }[] };
}

function concepts(idea: string, fr: boolean) {
  const base = idea.replace(/[.!?]+$/, "");
  const opts = fr
    ? [
        { title: "Intime", tone: "tendre, contemplatif", format: "court-métrage 2 min", angle: "au plus près d'un personnage" },
        { title: "Spectaculaire", tone: "épique, rythmé", format: "film 60 s", angle: "par l'image et le mouvement" },
        { title: "Décalé", tone: "drôle, inattendu", format: "spot 30 s", angle: "par un détournement" },
      ]
    : [
        { title: "Intimate", tone: "tender, contemplative", format: "2 min short", angle: "close to one character" },
        { title: "Spectacular", tone: "epic, rhythmic", format: "60 s film", angle: "through image and movement" },
        { title: "Offbeat", tone: "funny, unexpected", format: "30 s spot", angle: "through a twist" },
      ];
  return {
    options: opts.map((o) => ({
      title: o.title,
      pitch: `[mock] ${base}, raconté ${o.angle}.`,
      intention: fr ? `[mock] Faire ressentir « ${base} » ${o.angle}.` : `[mock] Make people feel "${base}" ${o.angle}.`,
      tone: o.tone,
      audience: fr ? "grand public" : "general audience",
      format: o.format,
    })),
  };
}

function treatment(ctx: Ctx, fr: boolean) {
  // Names come from the idea only (concept texts may be mock templates).
  const source = ctx.idea?.value ?? "";
  const people = names(source);
  const where = places(source);
  const hero = people[0] ?? (fr ? "Héroïne" : "Heroine");
  const place = where[0] ?? (fr ? "Lieu principal" : "Main location");
  const titles = fr ? ["Ouverture", "Rencontre", "Bascule", "Résolution"] : ["Opening", "Encounter", "Turn", "Resolution"];
  return {
    artDirection: fr ? "[mock] Lumière naturelle rasante, palette chaude, grain léger." : "[mock] Low natural light, warm palette, light grain.",
    entities: [
      { name: hero, tag: "character", descriptor: fr ? "[mock] Trentaine, manteau long, regard calme." : "[mock] Thirties, long coat, calm gaze." },
      { name: place, tag: "location", descriptor: fr ? "[mock] Lieu ouvert, matières brutes, lumière de fin de journée." : "[mock] Open place, raw materials, late-day light." },
      { name: fr ? "Look" : "Look", tag: "look", descriptor: fr ? "[mock] Pellicule 35 mm, contrastes doux." : "[mock] 35 mm film, soft contrast." },
    ],
    sequences: titles.map((title, i) => ({
      title,
      summary: fr ? `[mock] ${title} : ${hero}, étape ${i + 1} de l'histoire.` : `[mock] ${title}: ${hero}, step ${i + 1} of the story.`,
      location: place,
    })),
  };
}

function breakdown(ctx: Ctx, fr: boolean) {
  const t = ctx.treatment ?? { entities: [], sequences: [] };
  const hero = t.entities.find((e) => e.tag === "character")?.name;
  const place = t.entities.find((e) => e.tag === "location")?.name;
  const seqs = t.sequences.length ? t.sequences : [{ title: fr ? "Séquence 1" : "Sequence 1", summary: "", location: place }];
  return {
    sequences: seqs.map((s) => {
      const loc = s.location ?? place;
      const at = [loc].filter((x): x is string => !!x);
      const who = [hero, loc].filter((x): x is string => !!x);
      return {
        title: s.title,
        summary: s.summary,
        shots: [
          { description: fr ? `[mock] ${loc ?? "Le lieu"}, vue d'ensemble.` : `[mock] ${loc ?? "The place"}, establishing view.`, durationSec: 4, camera: { scale: "wide", angle: "eye_level", movement: "static" }, refs: at },
          { description: fr ? `[mock] ${hero ?? "Le personnage"} avance.` : `[mock] ${hero ?? "The character"} walks in.`, durationSec: 5, camera: { scale: "medium", angle: "eye_level", movement: "dolly_in", speed: "slow" }, refs: who },
          { description: fr ? `[mock] Visage de ${hero ?? "personnage"}.` : `[mock] ${hero ?? "Character"}'s face.`, durationSec: 3, camera: { scale: "close", angle: "eye_level", movement: "static" }, refs: hero ? [hero] : [] },
        ],
      };
    }),
  };
}

interface EnhanceCtx {
  target?: "image" | "video";
  instruction?: string;
}

/** Mock prompt enhancer: keeps the prompt word for word and adds generic craft terms. */
function enhance(prompt: string, ctx: EnhanceCtx) {
  const base = prompt.trim().replace(/[.\s]+$/, "");
  const extra =
    ctx.target === "video"
      ? "slow cinematic camera movement, natural motion, consistent lighting, 24 fps film look"
      : "cinematic composition, soft directional light, rich textures, 35 mm film grain, shallow depth of field";
  return { prompt: `${base}. ${extra}${ctx.instruction ? `, ${ctx.instruction}` : ""}.` };
}

export function mockTask(task: DigestTask, input: { brief: string; context?: unknown }, vars: Record<string, string | number>): unknown {
  const fr = (vars.language ?? language(input.brief)) !== "en";
  const ctx = (input.context ?? {}) as Ctx;
  switch (task) {
    case "diagnose":
      return diagnose(input.brief);
    case "extract":
      return extract(input.brief, Number(vars.level ?? 1));
    case "concepts":
      return concepts(ctx.idea?.value ?? input.brief, fr);
    case "concept": {
      const one = concepts(ctx.idea?.value ?? input.brief, fr).options[0];
      const given = ctx.concept ?? {};
      return Object.fromEntries(
        (["pitch", "intention", "tone", "audience", "format"] as const).map((k) => [k, given[k]?.value || one[k]]),
      );
    }
    case "treatment":
      return treatment(ctx, fr);
    case "breakdown":
      return breakdown(ctx, fr);
    case "enhance":
      return enhance(input.brief, (input.context ?? {}) as EnhanceCtx);
  }
}

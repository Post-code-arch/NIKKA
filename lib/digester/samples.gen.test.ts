import { writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "vitest";
import { BRIEF_BREAKDOWN, BRIEF_CONCEPT, BRIEF_SENTENCE } from "./fixtures/briefs";

it("writes samples", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nikka-samples-"));
  process.env.NIKKA_MOCK_ATLAS = "1";
  process.env.NIKKA_DB_PATH = path.join(dir, "s.db");
  const { getDb, schema } = await import("@/db");
  const { analyzeBrief } = await import("./service");
  const { SCALE_LABEL, MOVEMENT_LABEL, ANGLE_LABEL } = await import("@/lib/camera/labels");
  let md = "";
  for (const [title, brief] of [["Une phrase", BRIEF_SENTENCE], ["Un concept d'un paragraphe", BRIEF_CONCEPT], ["Un découpage de 10 plans", BRIEF_BREAKDOWN]] as const) {
    const p = getDb().insert(schema.projects).values({ name: title, settings: { defaultModels: {} } }).returning().get();
    const { state: s } = await analyzeBrief(p.id, brief);
    md += `## ${title}\n\n> ${brief.replace(/\n/g, "\n> ")}\n\n`;
    md += `**Diagnostic** : niveau ${s.diagnosis!.level} — ${s.diagnosis!.summary}\n\n`;
    md += `**Idée** (${s.idea!.origin}) : ${s.idea!.value}\n\n`;
    if (s.conceptOptions) md += `**Pistes proposées** :\n${s.conceptOptions.map((o) => `- *${o.title}* — ${o.pitch} (${o.tone} · ${o.format})`).join("\n")}\n\n`;
    if (s.concept) md += `**Concept** :\n${Object.entries(s.concept).map(([k, f]) => `- ${k} (${f.origin}) : ${f.value || "—"}`).join("\n")}\n\n`;
    if (s.treatment) {
      md += `**Traitement** — direction artistique (${s.treatment.artDirection.origin}) : ${s.treatment.artDirection.value || "—"}\n\n`;
      md += `Entités :\n${s.treatment.entities.map((e) => `- ${e.name} [${e.tag}] (${e.origin}) : ${e.descriptor || "—"}`).join("\n")}\n\n`;
      if (s.treatment.sequences.length) md += `Séquences :\n${s.treatment.sequences.map((q) => `- ${q.title} (${q.origin}) : ${q.summary || "—"}`).join("\n")}\n\n`;
    }
    if (s.breakdown) {
      md += `**Découpage** :\n\n| Plan | Action | Échelle | Angle | Mouvement | Durée | Dialogue / son | Réfs | Origine |\n|---|---|---|---|---|---|---|---|---|\n`;
      s.breakdown.sequences.forEach((q, i) =>
        q.shots.forEach((sh, j) => {
          md += `| ${i + 1}.${j + 1} | ${sh.description} | ${SCALE_LABEL[sh.camera.scale]} | ${ANGLE_LABEL[sh.camera.angle]} | ${MOVEMENT_LABEL[sh.camera.movement]}${sh.camera.speed ? ` (${sh.camera.speed})` : ""} | ${sh.durationSec}s | ${[sh.dialogue && `« ${sh.dialogue} »`, sh.sound && `son : ${sh.sound}`].filter(Boolean).join(" · ") || "—"} | ${sh.refs.join(", ") || "—"} | ${sh.origin} |\n`;
        }),
      );
      md += "\n";
    }
  }
  writeFileSync(path.join(process.cwd(), "docs", "digester-samples.md"), `# Sorties du digester sur les trois briefs de test (mode mock)\n\nGénéré par \`lib/digester/samples.gen.test.ts\`. En mode mock, l'extraction est faite par des règles (fidèle, sans invention) et les propositions sont des gabarits marqués [mock]. Avec le vrai LLM, mêmes schémas et mêmes étapes.\n\n${md}`);
});

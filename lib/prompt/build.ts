/**
 * PromptBuilder (PRD §7): [frozen descriptors of the connected entities] +
 * [shot action] + [camera translation] + [look]. Descriptors are inserted
 * verbatim and never rewritten.
 */

export interface PromptPart {
  kind: "descriptor" | "action" | "camera" | "look";
  /** Where it comes from, for the UI (reference name, « action du plan »…). */
  source: string;
  text: string;
}

export interface PromptInput {
  descriptors: { name: string; descriptor: string }[];
  action: string;
  camera: string;
  looks?: { name: string; descriptor: string }[];
}

function sentence(text: string): string {
  const t = text.trim();
  if (!t) return "";
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

export function buildPrompt(input: PromptInput): { prompt: string; parts: PromptPart[] } {
  const parts: PromptPart[] = [];
  for (const d of input.descriptors) {
    if (d.descriptor.trim()) parts.push({ kind: "descriptor", source: d.name, text: d.descriptor.trim() });
  }
  if (input.action.trim()) parts.push({ kind: "action", source: "Action du plan", text: input.action.trim() });
  if (input.camera.trim()) parts.push({ kind: "camera", source: "Caméra", text: input.camera.trim() });
  for (const l of input.looks ?? []) {
    if (l.descriptor.trim()) parts.push({ kind: "look", source: l.name, text: l.descriptor.trim() });
  }
  const prompt = parts
    .map((p) => (p.kind === "camera" ? sentence(p.text.charAt(0).toUpperCase() + p.text.slice(1)) : sentence(p.text)))
    .join(" ");
  return { prompt, parts };
}

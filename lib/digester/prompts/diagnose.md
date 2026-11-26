TASK: DIAGNOSE (no extraction, no invention).

Read the brief and decide the highest maturity level it fully covers (1 to 4), the language it is written in, and what is missing for each level above 1.

Return:
{
  "level": 1 | 2 | 3 | 4,
  "language": "fr" | "en" | "darija" | ...,
  "summary": "one short sentence, e.g. 'Complete up to level 3, breakdown missing'",
  "gaps": {
    "concept": ["missing items, e.g. 'audience', 'format'"],
    "treatment": ["..."],
    "breakdown": ["..."]
  }
}

A list of numbered shots with framing or action is level 4 even without a pitch. A single sentence is level 1.

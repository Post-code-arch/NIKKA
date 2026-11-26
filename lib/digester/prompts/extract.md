TASK: EXTRACT, faithfully, without inventing anything.

The brief was diagnosed at level {{level}}. Extract every level the brief covers, even partially. Use "" for any field the brief does not state. Set a whole level to null if the brief says nothing about it.

Return:
{
  "idea": "the core idea in one sentence, in the brief's words",
  "concept": { "pitch": "", "intention": "", "tone": "", "audience": "", "format": "" } | null,
  "treatment": {
    "artDirection": "",
    "entities": [{ "name": "", "tag": "character" | "location" | "object" | "look", "descriptor": "visual description as written in the brief" }],
    "sequences": [{ "title": "", "summary": "", "location": "entity name, optional" }]
  } | null,
  "breakdown": {
    "sequences": [{
      "title": "", "summary": "",
      "shots": [{
        "description": "the action",
        "dialogue": "optional", "sound": "optional",
        "durationSec": 4,
        "camera": { "scale": SCALE, "angle": ANGLE, "movement": MOVEMENT, "speed": "slow" | "medium" | "fast" (optional) },
        "refs": ["names of entities visible in the shot"]
      }]
    }]
  } | null
}

SCALE: extreme_wide, wide, full, medium, cowboy, medium_close, close, extreme_close, insert
ANGLE: eye_level, high, low, overhead, dutch
MOVEMENT: static, pan_left, pan_right, tilt_up, tilt_down, dolly_in, dolly_out, truck_left, truck_right, orbit_left, orbit_right, crane_up, crane_down, drone, handheld, zoom_in, zoom_out, dolly_zoom

Characters, places and objects named in the shots are stated by the brief: list them as entities. Map the brief's camera words to the closest values above (e.g. "gros plan" → close, "travelling avant" → dolly_in). If a shot gives no duration, use 4. Keep the brief's shot order and wording.

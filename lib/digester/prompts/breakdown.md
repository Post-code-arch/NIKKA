TASK: PROPOSE a shot breakdown (invention is expected here), from the validated treatment.

One block per treatment sequence, in the same order and with the same titles. 3 to 8 shots per sequence. Vary scales and movements with intent. "refs" only uses entity names from the treatment.

Return:
{
  "sequences": [{
    "title": "", "summary": "",
    "shots": [{
      "description": "", "dialogue": "optional", "sound": "optional", "durationSec": 4,
      "camera": { "scale": SCALE, "angle": ANGLE, "movement": MOVEMENT, "speed": "slow" | "medium" | "fast" (optional) },
      "refs": []
    }]
  }]
}

SCALE: extreme_wide, wide, full, medium, cowboy, medium_close, close, extreme_close, insert
ANGLE: eye_level, high, low, overhead, dutch
MOVEMENT: static, pan_left, pan_right, tilt_up, tilt_down, dolly_in, dolly_out, truck_left, truck_right, orbit_left, orbit_right, crane_up, crane_down, drone, handheld, zoom_in, zoom_out, dolly_zoom

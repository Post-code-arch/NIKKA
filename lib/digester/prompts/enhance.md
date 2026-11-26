TASK: ENHANCE a prompt for an AI {{target}} generator (invention of visual detail is expected here).

BRIEF contains the user's prompt. Rewrite it as one rich, precise generation prompt:
- keep every element, name and intention of the original prompt, and its order of importance;
- add concrete visual detail: subject, setting, composition, light, colour, texture, lens, mood;
- for video, describe the action over time and the camera movement in one or two short sentences;
- follow the user's extra instruction if CONTEXT gives one ({{instruction}});
- no lists, no Markdown, no quotation marks around the result; 40 to 120 words;
- write the enhanced prompt in English (generation models follow English best), unless the instruction asks otherwise.

Return: { "prompt": "the enhanced prompt" }

"""Speed up action stretches after the fact: from a caption's start plus a reading lead, to the next
caption (or the end), at a speed. Earlier marks (the AI's waits) keep their own speed."""

import json
import os
from pathlib import Path

SCENES = Path(__file__).parent / (
    "scenes-voice" if os.environ.get("SCENES") == "voice" else "scenes"
)

PLAN = {
    # scene: [(caption index, seconds to read first, speed)]
    "03-customer": [(1, 3.0, 1.45)],
    "04-handler": [(3, 3.0, 1.6), (4, 3.0, 1.6)],
    "08-secure": [(1, 3.5, 1.7), (2, 3.5, 1.6)],
}
for name, cuts in PLAN.items():
    f = SCENES / name / "rec.json"
    rec = json.loads(f.read_text())
    rec["marks"] = [m for m in rec["marks"] if not m.get("trim")]
    caps = rec["caps"]
    for i, lead, speed in cuts:
        a = caps[i]["t"] + lead
        b = caps[i + 1]["t"] if i + 1 < len(caps) else rec["end"]
        if b > a:
            rec["marks"].append({"a": a, "b": b, "speed": speed, "trim": True})
    f.write_text(json.dumps(rec, indent=1))
    print(name, "ok")

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import json, csv, random

OUT = Path.home() / "lectern-eval" / "outputs"
CLIPS = ["01-clean", "02-accent", "03-noise", "04-technical", "05-multispeaker"]
N = 100
random.seed(42)


def to_mmss(seconds):
    if seconds is None or seconds == "":
        return ""
    total = int(float(seconds))
    return f"{total // 60}:{total % 60:02d}"


all_bullets = []
for clip in CLIPS:
    p = OUT / f"{clip}.lectern.json"
    if not p.exists():
        continue
    payload = json.loads(p.read_text())
    for sec in payload["notes"]["sections"]:
        for b in sec["bullets"]:
            all_bullets.append({
                "clip":          clip,
                "section":       sec["title"],
                "section_start": to_mmss(sec["start"]),
                "section_end":   to_mmss(sec["end"]),
                "bullet":        b["text"],
                "source":        b["source"],
                "segment_start": to_mmss(b.get("segment_start")),
                "segment_end":   to_mmss(b.get("segment_end")),
            })

transcript = [b for b in all_bullets if b["source"] == "transcript"]
unverified = [b for b in all_bullets if b["source"] == "unverified_llm"]
n_total = len(transcript) + len(unverified)
take_tr  = round(N * len(transcript) / n_total)
take_un  = N - take_tr
print(f"Pool: {len(transcript)} transcript + {len(unverified)} unverified = {n_total}")
print(f"Sampling {take_tr} transcript + {take_un} unverified = {N}")

sample = (random.sample(transcript, min(take_tr, len(transcript))) +
          random.sample(unverified,  min(take_un, len(unverified))))
random.shuffle(sample)

out = OUT / "provenance_audit.csv"
fieldnames = ["clip", "section", "section_start", "section_end",
              "bullet", "source", "segment_start", "segment_end",
              "Q1_in_transcript", "actual_timestamp", "notes"]
with out.open("w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=fieldnames)
    w.writeheader()
    for b in sample:
        b["Q1_in_transcript"] = ""
        b["actual_timestamp"]  = ""
        b["notes"]             = ""
        w.writerow(b)

print(f"Written to {out}")
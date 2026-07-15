"""Compute WER per clip and aggregate."""
import sys
import json
import string
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import jiwer

CORPUS = Path.home() / "lectern-eval" / "corpus"
OUT    = Path.home() / "lectern-eval" / "outputs"
CLIPS = ["01-clean", "02-accent", "03-noise", "04-technical", "05-multispeaker"]

def normalise(s):
    s = s.lower()
    s = s.translate(str.maketrans("", "", string.punctuation))
    return " ".join(s.split())

print(f"{'clip':<15} {'WER':>7}  {'S':>5} {'D':>5} {'I':>5}")
print("-" * 45)

all_refs, all_hyps = [], []
for clip in CLIPS:
    ref_p = CORPUS / f"{clip}.en.txt"
    out_p = OUT    / f"{clip}.lectern.json"
    if not ref_p.exists() or not out_p.exists():
        print(f"[skip] {clip}")
        continue
    payload = json.loads(out_p.read_text())
    hyp = " ".join(s["text"] for s in payload["segments"])
    rn, hn = normalise(ref_p.read_text()), normalise(hyp)
    out = jiwer.process_words(rn, hn)
    print(f"{clip:<15} {out.wer*100:>6.1f}%  {out.substitutions:>5} {out.deletions:>5} {out.insertions:>5}")
    all_refs.append(rn); all_hyps.append(hn)

agg_ref = " ".join(all_refs)
agg_hyp = " ".join(all_hyps)
agg = jiwer.process_words(agg_ref, agg_hyp)
print("-" * 45)
print(f"{'aggregate':<15} {agg.wer*100:>6.1f}%  {agg.substitutions:>5} {agg.deletions:>5} {agg.insertions:>5}")
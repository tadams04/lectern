import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import csv, statistics

def parse_mmss(s):
    if not s or not s.strip():
        return None
    parts = s.strip().split(':')
    try:
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        return float(s)
    except ValueError:
        return None

p = Path.home() / "lectern-eval" / "outputs" / "provenance_audit.csv"

matrix = {(s, q): 0
          for s in ["transcript", "unverified_llm"]
          for q in ["yes", "partial", "no"]}
ts_offsets = []

with p.open() as f:
    for row in csv.DictReader(f):
        q1  = row["Q1_in_transcript"].strip().lower()
        src = row["source"]
        if (src, q1) in matrix:
            matrix[(src, q1)] += 1
        actual  = parse_mmss(row.get("actual_timestamp", ""))
        claimed = parse_mmss(row.get("segment_start", ""))
        if actual is not None and claimed is not None and src == "transcript" and q1 == "yes":
            ts_offsets.append(abs(actual - claimed))

total = sum(matrix.values())
print(f"Labelled: {total}\n")
print(f"{'':20} {'yes':>6} {'partial':>8} {'no':>6}")
for src in ["transcript", "unverified_llm"]:
    print(f"{src:20} "
          f"{matrix[(src,'yes')]:>6} "
          f"{matrix[(src,'partial')]:>8} "
          f"{matrix[(src,'no')]:>6}")

honest = (matrix[("transcript",   "yes")]
        + matrix[("unverified_llm","no")]
        + matrix[("unverified_llm","partial")])
print(f"\nProvenance-honest rate: {honest}/{total} = {honest/total*100:.1f}%")
print(f"Misattribution (transcript + no): {matrix[('transcript','no')]}")

if ts_offsets:
    print(f"\nTimestamp offsets (n={len(ts_offsets)}):")
    print(f"  mean   = {statistics.mean(ts_offsets):.1f}s")
    print(f"  median = {statistics.median(ts_offsets):.1f}s")
    print(f"  max    = {max(ts_offsets):.1f}s")
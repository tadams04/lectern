import sys, json, csv
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

OUT = Path.home() / "lectern-eval" / "outputs"
gold_path = OUT / "announcements_gold.csv"
TOLERANCE_S = 15

gold = {}
with gold_path.open() as f:
    for row in csv.DictReader(f):
        gold.setdefault(row["clip"], []).append(row)

sys_out = {}
for clip in gold:
    p = OUT / f"{clip}.lectern.json"
    payload = json.loads(p.read_text())
    sys_out[clip] = payload["notes"]["announcements"]

def match(g, s_list, used):
    for i, s in enumerate(s_list):
        if i in used: continue
        if abs(s["timestamp"] - float(g["timestamp_seconds"])) < TOLERANCE_S:
            return i, s
    return None, None

print(f"{'clip':<20} {'|G|':>4} {'|S|':>4} {'TP':>4} {'P':>7} {'R':>7} {'F1':>7}")
print("-" * 55)

total_tp = total_g = total_s = type_correct = total_matched = 0
for clip, glist in gold.items():
    s_list = sys_out.get(clip, [])
    used = set()
    tp = 0
    for g in glist:
        idx, s = match(g, s_list, used)
        if s is not None:
            tp += 1
            used.add(idx)
            total_matched += 1
            if (s.get("type") or "").lower() == g["type"].lower():
                type_correct += 1
    p  = tp / max(len(s_list), 1)
    r  = tp / max(len(glist),  1)
    f1 = 2*p*r / max(p+r, 1e-9)
    print(f"{clip:<20} {len(glist):>4} {len(s_list):>4} {tp:>4} "
          f"{p*100:>6.1f}% {r*100:>6.1f}% {f1*100:>6.1f}%")
    total_tp += tp; total_g += len(glist); total_s += len(s_list)

P  = total_tp / max(total_s, 1)
R  = total_tp / max(total_g, 1)
F1 = 2*P*R / max(P+R, 1e-9)
print("-" * 55)
print(f"{'total':<20} {total_g:>4} {total_s:>4} {total_tp:>4} "
      f"{P*100:>6.1f}% {R*100:>6.1f}% {F1*100:>6.1f}%")
print(f"\nType accuracy on TPs: "
      f"{type_correct}/{total_matched} = "
      f"{type_correct/max(total_matched,1)*100:.1f}%")

print("\n--- False positives ---")
fp_count = 0
for clip, s_list in sys_out.items():
    glist = gold.get(clip, [])
    used = set()
    for g in glist:
        idx, _ = match(g, s_list, used)
        if idx is not None:
            used.add(idx)
    for i, s in enumerate(s_list):
        if i not in used:
            fp_count += 1
            print(f"  [{s.get('type','?')}] t={s.get('timestamp',0):.1f}s  "
                  f"{s.get('text','')[:80]}")
if fp_count == 0:
    print("  none")
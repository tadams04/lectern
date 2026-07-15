import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

PC  = Path.home() / "lectern-eval" / "outputs"
MAC = Path.home() / "lectern-eval" / "outputs-mac"
CLIPS = ["01-clean", "02-accent", "03-noise", "04-technical", "05-multispeaker"]

print(f"{'clip':<20} {'audio':>7} {'PC':>8} {'Mac':>8} {'speedup':>8}")
print("-" * 55)

total_pc, total_mac = 0, 0
for clip in CLIPS:
    p = PC  / f"{clip}.lectern.json"
    m = MAC / f"{clip}.lectern.json"
    if not p.exists() or not m.exists():
        print(f"{clip:<20} [missing]")
        continue
    pp = json.loads(p.read_text())
    mm = json.loads(m.read_text())
    audio  = pp["audio_seconds"]
    pc_t   = pp["timing"]["notes_and_announcements"]
    mac_t  = mm["timing"]["notes_and_announcements"]
    speedup = mac_t / pc_t
    print(f"{clip:<20} {audio:>6.0f}s {pc_t:>7.1f}s {mac_t:>7.1f}s {speedup:>7.2f}x")
    total_pc  += pc_t
    total_mac += mac_t

print("-" * 55)
print(f"{'mean speedup':<20} {'':>7} {'':>8} {'':>8} {total_mac/total_pc:>7.2f}x")
import sys, json, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from app.preprocessor import preprocess_audio
from app.asr import transcribe_to_segments
from app.note_generator import generate_structured_notes_chunked

CORPUS = Path.home() / "lectern-eval" / "corpus"
OUT    = Path.home() / "lectern-eval" / "outputs"

mp3 = CORPUS / "06-synthetic.mp3"
timing = {}

t0 = time.perf_counter()
pre = preprocess_audio(str(mp3))
timing["preprocess"] = time.perf_counter() - t0

t0 = time.perf_counter()
segments, _ = transcribe_to_segments(pre)
timing["asr"] = time.perf_counter() - t0
print(f"asr: {timing['asr']:.1f}s ({len(segments)} segments)")

t0 = time.perf_counter()
notes = generate_structured_notes_chunked(segments)
timing["notes_and_announcements"] = time.perf_counter() - t0
print(f"notes: {timing['notes_and_announcements']:.1f}s "
      f"({len(notes.sections)} sections, "
      f"{len(notes.announcements)} announcements)")

payload = {
    "clip": "06-synthetic",
    "timing": timing,
    "segments": [s.model_dump() for s in segments],
    "notes": notes.model_dump(),
}
out_path = OUT / "06-synthetic.lectern.json"
out_path.write_text(json.dumps(payload, indent=2))
print(f"saved: {out_path}")

print("\n--- Announcements found ---")
for a in notes.announcements:
    print(f"  [{a.type}] {a.text[:80]}")
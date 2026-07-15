"""Run the full Lectern pipeline on each clip and save the output as JSON."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import json, time
from app.preprocessor import preprocess_audio
from app.asr import transcribe_to_segments
from app.note_generator import generate_structured_notes_chunked

CORPUS = Path.home() / "lectern-eval" / "corpus"
OUT = Path.home() / "lectern-eval" / "outputs"
OUT.mkdir(parents=True, exist_ok=True)

CLIPS = ["01-clean", "02-accent", "03-noise", "04-technical", "05-multispeaker"]

for clip in CLIPS:
    mp3 = CORPUS / f"{clip}.mp3"
    if not mp3.exists():
        print(f"[skip] {mp3} not found")
        continue

    print(f"\n=== {clip} ===")
    timing = {}

    t0 = time.perf_counter()
    pre = preprocess_audio(str(mp3))
    timing["preprocess"] = time.perf_counter() - t0

    t0 = time.perf_counter()
    segments, _ = transcribe_to_segments(pre)
    timing["asr"] = time.perf_counter() - t0
    print(f"  asr     {timing['asr']:>6.1f}s ({len(segments)} segments)")

    t0 = time.perf_counter()
    notes = generate_structured_notes_chunked(segments)
    timing["notes_and_announcements"] = time.perf_counter() - t0
    print(f"  notes   {timing['notes_and_announcements']:>6.1f}s "
          f"({len(notes.sections)} sections, {len(notes.announcements)} announcements)")

    # Audio length for the perf table
    import subprocess
    duration = float(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(mp3),
    ]).strip())
    timing["audio_seconds"] = duration

    payload = {
        "clip": clip,
        "audio_seconds": duration,
        "timing": timing,
        "segments": [s.model_dump() for s in segments],
        "notes": notes.model_dump(),
    }
    out_path = OUT / f"{clip}.lectern.json"
    out_path.write_text(json.dumps(payload, indent=2))
    print(f"  saved   {out_path}")
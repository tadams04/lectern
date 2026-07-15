from __future__ import annotations

import os
from typing import List, Tuple

import httpx

from .models import TranscriptSegment

# Points to the faster-whisper service running on home PC over Tailscale.
# Set ASR_URL in your .env file. Falls back to localhost for pure local dev.
ASR_URL = os.getenv("ASR_URL", "http://localhost:8001/transcribe")


def transcribe_to_segments(file_path: str) -> Tuple[List[TranscriptSegment], dict]:
    """
    Sends the audio file to the remote ASR service on the home PC.
    Returns timestamped transcript segments and an info dict.
    """
    with open(file_path, "rb") as f:
        filename = file_path.split("/")[-1]
        response = httpx.post(
            ASR_URL,
            files={"file": (filename, f, "audio/mpeg")},
            timeout=600.0,  # long audio files take time - don't lower this
        )

    response.raise_for_status()
    data = response.json()

    segments = [TranscriptSegment(**s) for s in data["segments"]]
    info = {
        "language": data.get("language"),
        "duration": data.get("duration"),
    }
    return segments, info

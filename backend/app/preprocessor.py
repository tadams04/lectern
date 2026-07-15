from __future__ import annotations
import subprocess

def preprocess_audio(file_path: str) -> str:
    output_path = file_path.rsplit(".", 1)[0] + "_preprocessed.mp3"

    subprocess.run([
        "ffmpeg",
        "-i", file_path,        # input file (any format)
        "-vn",                   # strip video
        "-ac", "1",              # mono (stereo is wasteful for speech)
        "-ar", "16000",          # 16kHz sample rate (ideal for whisper)
        "-b:a", "32k",           # 32kbps bitrate (fine for speech, tiny file)
        "-y",                    # overwrite output if exists
        output_path
    ], check=True)

    return output_path
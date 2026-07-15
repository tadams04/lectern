# Infrastructure Setup

## Architecture

The system runs across two machines connected over Tailscale.

| MacBook (dev) | Ubuntu PC (inference) |
|---|---|
| FastAPI backend | Ollama / qwen2.5:14b — port 11434 |
| React frontend | faster-whisper ASR service — port 8001 |
| Receives uploads, forwards to PC | AMD RX 6750 XT via ROCm |

faster-whisper runs on CPU, not the GPU. CTranslate2 int8 CPU inference is
faster than GPU inference for Whisper on this hardware. The GPU is reserved
entirely for Ollama.

---

## Environment Variables

Create `backend/.env` (never committed):

```
ASR_URL=http://<tailscale-ip>:8001/transcribe
OLLAMA_URL=http://<tailscale-ip>:11434/api/generate
OLLAMA_MODEL=qwen2.5:14b
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_KEY=<anon-key>
```

Replace `<tailscale-ip>` with the Ubuntu PC's Tailscale IP (`tailscale ip -4`
on the PC).

---

## Ubuntu PC Setup

### ROCm (AMD GPU acceleration)

```bash
sudo usermod -aG render,video $USER

# ROCm 7.2 — verified working with RX 6750 XT
wget https://repo.radeon.com/amdgpu-install/7.2/ubuntu/noble/amdgpu-install_7.2.70200-1_all.deb
sudo apt install ./amdgpu-install_7.2.70200-1_all.deb -y
sudo apt update
sudo apt install python3-setuptools python3-wheel rocm -y
sudo reboot
```

Verify: `rocm-smi` should list the RX 6750 XT.

### Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:14b
```

Configure Ollama to accept remote connections and use the GPU:

```bash
sudo systemctl edit ollama
```

Add between the comment lines:

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
Environment="HSA_OVERRIDE_GFX_VERSION=11.0.0"
```

```bash
sudo systemctl daemon-reload && sudo systemctl restart ollama
```

`HSA_OVERRIDE_GFX_VERSION=11.0.0` is required — without it ROCm does not
recognise the RX 6750 XT and Ollama falls back silently to CPU.

### faster-whisper ASR Service

```bash
mkdir ~/asr-service && cd ~/asr-service
python3 -m venv venv
source venv/bin/activate
pip install faster-whisper fastapi "uvicorn[standard]" python-multipart
```

Create `~/asr-service/asr_service.py` with this content:

```python
"""
asr_service.py — runs on the Ubuntu PC.
Wraps faster-whisper as an HTTP endpoint the Mac backend calls.

Start manually:
    uvicorn asr_service:app --host 0.0.0.0 --port 8001
"""

import shutil
import tempfile
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, File, UploadFile
from faster_whisper import WhisperModel

app = FastAPI()


@lru_cache(maxsize=1)
def get_model():
    # CPU is intentional — faster-whisper int8 CPU inference is faster
    # than GPU inference for Whisper on the RX 6750 XT.
    # The GPU is reserved for Ollama.
    return WhisperModel("medium", device="cpu", compute_type="int8")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    suffix = Path(file.filename or "audio.mp3").suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        tmp_path = tmp.name
    try:
        model = get_model()
        segments_iter, info = model.transcribe(
            tmp_path,
            vad_filter=True,
            language="en",
            beam_size=5,
            best_of=5,
            temperature=0,
        )
        segments = [
            {"start": float(seg.start), "end": float(seg.end), "text": seg.text.strip()}
            for seg in segments_iter
            if seg.text.strip()
        ]
    finally:
        Path(tmp_path).unlink(missing_ok=True)
    return {
        "segments": segments,
        "language": getattr(info, "language", None),
        "duration": getattr(info, "duration", None),
    }
```

The first run downloads the Whisper medium model (~1.5 GB).

**Run as a systemd service** so it starts automatically on boot:

```bash
sudo nano /etc/systemd/system/asr-service.service
```

```ini
[Unit]
Description=faster-whisper ASR Service
After=network.target

[Service]
Type=simple
User=<your-username>
WorkingDirectory=/home/<your-username>/asr-service
ExecStart=/home/<your-username>/asr-service/venv/bin/uvicorn asr_service:app --host 0.0.0.0 --port 8001
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable asr-service
sudo systemctl start asr-service
```

### Tailscale

```bash
# On PC
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up   # follow the URL to authorise
tailscale ip -4     # note this IP — goes in backend/.env
```

On Mac: install the app from https://tailscale.com/download/mac (not brew).
Sign in with the same account.

---

## Daily Workflow

Boot the PC — Ollama and the ASR service start automatically.

```bash
# Terminal 1 — backend (from repo root)
cd backend && source .venv/bin/activate
uvicorn app.main:app --reload

# Terminal 2 — frontend
cd frontend && npm run dev
```

### Monitoring

```bash
# On PC
watch -n 2 rocm-smi              # VRAM% spikes during LLM generation
journalctl -u asr-service -f     # ASR service logs
journalctl -u ollama -f          # Ollama logs
```

Repeated `GET /jobs/{id}` lines in the uvicorn log are normal — the frontend
polls every 4 seconds while a job is processing.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| curl to PC times out | `tailscale status` on both machines — both should show Connected |
| Ollama not reachable from Mac | Check `OLLAMA_HOST=0.0.0.0` is in the systemd edit |
| Ollama running on CPU | Check `HSA_OVERRIDE_GFX_VERSION=11.0.0` is in the systemd edit, restart Ollama |
| rocm-smi shows no GPU | Reboot after ROCm install; confirm user is in `render` and `video` groups |
| ASR service not reachable | `sudo systemctl status asr-service` |
| ASR service fails to start | Confirm `<your-username>` in the service file matches your actual Linux username |
| asr_service import error | Filename must be `asr_service.py` with underscore, not hyphen |
| `.env` vars not picked up | `load_dotenv(...)` must appear before all local imports in `main.py` |
| Transcription timeout | Increase `timeout=600.0` in `backend/app/asr.py` |
| Services don't auto-start | `sudo systemctl enable ollama && sudo systemctl enable asr-service` |
| Can't see GRUB on boot | Hold Shift during boot |
| Tailscale won't start on Mac | Use the app from tailscale.com — not `brew install tailscale` |

### Confirming Ollama is using the GPU

In `journalctl -u ollama -f` during a generation you should see:

```
load_tensors: ROCm model buffer size = 8566.04 MiB   ← good
load_tensors: CPU  model buffer size = 8566.04 MiB   ← bad, check env vars
```

"""
BridgeSign Whisper Transcription Server
Accepts audio chunks via POST /api/transcribe and returns text.
Uses faster-whisper for efficient real-time transcription.

Usage:
    pip install -r requirements.txt
    python server.py
"""

import io
import os
import tempfile
import logging

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

# --------------- Config ---------------
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "base")  # tiny, base, small, medium, large-v3
DEVICE = os.environ.get("WHISPER_DEVICE", "auto")      # auto, cpu, cuda
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE", "int8")  # float16, int8, float32
PORT = int(os.environ.get("WHISPER_PORT", "8090"))

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("whisper-server")

# --------------- App ---------------
app = FastAPI(title="BridgeSign Whisper Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)

# --------------- Model (lazy load) ---------------
model = None

def get_model():
    global model
    if model is None:
        from faster_whisper import WhisperModel
        log.info(f"Loading Whisper model '{MODEL_SIZE}' on {DEVICE} ({COMPUTE_TYPE})...")
        model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
        log.info("Model loaded.")
    return model


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_SIZE, "device": DEVICE}


@app.post("/api/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """
    Accepts an audio file (WebM/Opus, WAV, etc.) and returns transcribed text.
    The extension sends ~3-second audio chunks from tabCapture.
    """
    try:
        contents = await audio.read()

        if len(contents) < 100:
            return JSONResponse({"text": "", "segments": []})

        # Write to temp file (faster-whisper needs a file path or file-like)
        suffix = ".webm" if "webm" in (audio.content_type or "") else ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        try:
            m = get_model()
            segments, info = m.transcribe(
                tmp_path,
                beam_size=1,          # Faster for real-time
                language="en",        # Set to None for auto-detect
                vad_filter=True,      # Skip silence
                vad_parameters=dict(
                    min_silence_duration_ms=500,
                ),
            )

            text_parts = []
            segment_list = []
            for seg in segments:
                text_parts.append(seg.text.strip())
                segment_list.append({
                    "start": round(seg.start, 2),
                    "end": round(seg.end, 2),
                    "text": seg.text.strip(),
                })

            full_text = " ".join(text_parts)
            return JSONResponse({"text": full_text, "segments": segment_list})

        finally:
            os.unlink(tmp_path)

    except Exception as e:
        log.error(f"Transcription error: {e}", exc_info=True)
        return JSONResponse({"text": "", "error": str(e)}, status_code=500)


if __name__ == "__main__":
    # Pre-load model on startup
    get_model()
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")

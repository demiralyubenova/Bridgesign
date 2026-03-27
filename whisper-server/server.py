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


# Known Whisper hallucinations on silent/near-silent audio
HALLUCINATION_PHRASES = {
    "thank you", "thanks for watching", "thanks for listening",
    "subscribe", "like and subscribe", "see you next time",
    "bye", "goodbye", "thank you for watching",
    "please subscribe", "thanks", "you", "yeah",
    "the end", "so", "okay", "oh", "uh", "um",
    "hmm", "huh", "ah", "i'm sorry", "sorry",
    "what", "yes", "no", "right", "well",
    "hello", "hi", "hey", "good", "all right",
    "i don't know", "you know", "i mean",
}


def is_hallucination(text: str) -> bool:
    """Check if the transcribed text is a known Whisper hallucination."""
    cleaned = text.strip().lower().rstrip(".!?,;:")
    if not cleaned:
        return True
    if cleaned in HALLUCINATION_PHRASES:
        return True

    # Repeated short phrase detection (e.g. "Thank you. Thank you. Thank you.")
    words = cleaned.split()
    if len(words) <= 4:
        return True  # Very short outputs on 5-6s chunks are almost always hallucinations

    # Detect repetition: if the same short phrase repeats, it's a hallucination
    # e.g. "Thank you. Thank you. Thank you. Thank you."
    sentences = [s.strip().lower().rstrip(".!?,;:") for s in text.split(".") if s.strip()]
    if len(sentences) >= 2:
        unique = set(sentences)
        if len(unique) <= 2:
            return True  # Same sentence repeated = hallucination

    return False


# Confidence thresholds for filtering Whisper output
NO_SPEECH_PROB_THRESHOLD = 0.6   # If Whisper thinks >60% chance of no speech, skip
AVG_LOGPROB_THRESHOLD = -1.0      # If avg log probability is very low, skip


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
                vad_filter=True,      # Filter out silence to prevent hallucinations
                vad_parameters=dict(
                    threshold=0.5,               # Higher = more aggressive silence filtering
                    min_silence_duration_ms=300,
                    min_speech_duration_ms=250,   # Ignore very short bursts (clicks, pops)
                    speech_pad_ms=150,
                ),
            )

            text_parts = []
            segment_list = []
            for seg in segments:
                seg_text = seg.text.strip()
                if not seg_text:
                    continue

                # Use Whisper's own confidence to reject hallucinations
                if seg.no_speech_prob > NO_SPEECH_PROB_THRESHOLD:
                    log.debug(f"Skipped (no_speech_prob={seg.no_speech_prob:.2f}): {seg_text}")
                    continue
                if seg.avg_logprob < AVG_LOGPROB_THRESHOLD:
                    log.debug(f"Skipped (avg_logprob={seg.avg_logprob:.2f}): {seg_text}")
                    continue

                text_parts.append(seg_text)
                segment_list.append({
                    "start": round(seg.start, 2),
                    "end": round(seg.end, 2),
                    "text": seg_text,
                })

            full_text = " ".join(text_parts)

            # Final hallucination check on the combined output
            if not full_text or is_hallucination(full_text):
                return JSONResponse({"text": "", "segments": []})

            log.info(f"Transcribed: {full_text[:80]}...")
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

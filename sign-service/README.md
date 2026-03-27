# SignFlow Sign Planner

Local Python service that converts finalized speech text into an ASL playback manifest.

## Provider mode

The planner now tries to use `sign-language-translator` first and falls back to the built-in SignFlow mapper if the library is unavailable.

You can force the provider with:

```bash
export SIGNFLOW_SIGN_PROVIDER=auto
```

Supported values:

- `auto`: prefer `sign-language-translator`, otherwise fallback
- `slt`: require `sign-language-translator`
- `fallback`: use only the built-in SignFlow planner

Important:

- `sign-language-translator` documents support for Python `3.9`, `3.10`, and `3.11`
- this machine is currently running Python `3.13`, so the package may not install here
- for the hackathon demo, use Python `3.11` if you want the library-enabled path

## Start

```bash
cd sign-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 172.20.10.8 --port 8001
```

## Media layout

Add validated ASL clips under:

```text
sign-service/media/asl/phrases/
sign-service/media/asl/fingerspelling/
sign-service/media/asl/days/
sign-service/media/asl/numbers/
```

Expected filenames:

- Phrase clips: lowercase slug ids such as `can-you-repeat-that.mp4`
- Fingerspelling clips: `fs-a.mp4` through `fs-z.mp4`
- Numbers: `num-0.mp4` through `num-9.mp4`
- Days: `monday.mp4` through `sunday.mp4`

If a clip is missing, the extension falls back to a readable sign card for that unit instead of blocking captions.

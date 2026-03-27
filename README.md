# SignFlow

Full repo documentation: [DOCUMENTATION.md](./DOCUMENTATION.md)

Real-time sign language and speech support for Google Meet.

## What This Version Adds

- Speech-to-text captions remain the primary live channel.
- Finalized speech phrases now generate an ASL playback manifest.
- The receiver sees captions and an ASL playback panel at the same time.
- Unknown words fall back to fingerspelling units instead of blocking the flow.

## Services

You now run two local services:

1. Relay server for room sync
2. Python sign planner for ASL playback manifests

## Quick Start

### 1. Start the relay server

```bash
cd server
npm install
npm start
```

Relay default: `ws://172.20.10.8:3001`

### 2. Start the sign planner

```bash
cd sign-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 172.20.10.8 --port 8001
```

Planner default: `http://172.20.10.8:8001`

### 3. Load the extension

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click Load unpacked
4. Select the repo root folder

### 4. Configure URLs if needed

The popup now exposes:

- Relay Server URL
- Sign Planner URL

Defaults:

- `ws://172.20.10.8:3001`
- `http://172.20.10.8:8001`

## ASL Media Assets

The sign planner ships with phrase matching and fingerspelling fallback, but it does not include real ASL clip files yet. Add validated clips under:

```text
sign-service/media/asl/phrases/
sign-service/media/asl/fingerspelling/
sign-service/media/asl/days/
sign-service/media/asl/numbers/
```

Expected filenames:

- phrase clips: lowercase slug ids such as `can-you-repeat-that.mp4`
- fingerspelling clips: `fs-a.mp4` through `fs-z.mp4`
- number clips: `num-0.mp4` through `num-9.mp4`
- day clips: `monday.mp4` through `sunday.mp4`

If a clip is missing, the extension shows a readable ASL unit card so captions still remain usable.

## Architecture

```text
speaker speech
  -> browser speech recognition
  -> live caption relay
  -> python sign planner
  -> sign plan relay
  -> receiver overlay
     -> captions + ASL playback queue
```

## Current Constraints

- v1 is optimized for ASL-first accessibility, not full open-domain ASL translation.
- Phrase quality depends on the clip library you add and validate with Deaf ASL users.
- Generic auto-avatar signing is intentionally not the primary path in this version.

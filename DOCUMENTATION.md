# BridgeSign Documentation

BridgeSign is a Google Meet accessibility prototype built as a Chrome extension plus two local services:

- a Node.js WebSocket relay server for room-based synchronization
- a Python FastAPI sign-planning service for ASL playback manifests

The current build follows a hybrid model:

- spoken language is captured as live captions immediately
- finalized speech is converted into an ASL playback manifest
- the receiving ASL-first user sees captions and ASL playback together
- unknown words fall back to fingerspelling instead of failing silently

## 1. Project Status

This repository is an MVP / hackathon-style prototype, not a production-ready accessibility platform.

What it currently does well:

- creates live transcript updates for a speaker inside Google Meet
- relays transcript and sign-plan events between peers in the same room
- generates phrase-first ASL playback plans with fallback behavior
- supports browser-side ASL recognition experiments using MediaPipe Hands
- provides an ASL playback UI with clip playback and readable fallback cards

What it does not currently do:

- full open-domain spoken-language-to-ASL translation
- robust multi-user conferencing beyond the configured room limit
- persistent storage of meetings, transcripts, or analytics
- guaranteed validated ASL clip coverage out of the box

## 2. Naming Note

The repo currently uses two names:

- `BridgeSign`: extension, popup, relay server, landing page, manifest, most UI copy
- `SignFlow`: planner README, planner comments, some legacy storage keys

Functionally this is one system. The extension-facing product name is `BridgeSign`, while parts of the planner still carry the older `SignFlow` label.

## 3. High-Level Architecture

```text
Google Meet speaker
  -> browser speech recognition
  -> extension content script
  -> background service worker
  -> WebSocket relay server
  -> remote signer client
  -> ASL playback panel

Finalized speech
  -> background service worker
  -> FastAPI sign planner
  -> ASL manifest
  -> local and remote signer playback
```

There are four major parts:

1. Chrome extension
2. Node relay server
3. Python sign planner
4. Static landing page

## 4. Repository Layout

```text
.
├── manifest.json                Chrome extension manifest
├── background.js                Extension service worker
├── content.js                   Main Meet overlay / UI logic
├── content.css                  Overlay styling
├── virtual-camera.js            Subtitle overlay camera patch
├── meet-caption-scraper.js      Google Meet caption scraping
├── motion-tracker.js            Dynamic gesture tracking
├── asl-recognition.js           Browser-side ASL recognition
├── sign-player.js               ASL playback queue and renderer
├── offscreen.html               Offscreen document host
├── offscreen.js                 MediaPipe Hands runtime
├── libs/                        MediaPipe Hands assets
├── popup/                       Extension popup UI
├── landing-page/                Marketing / demo page
├── server/                      WebSocket relay service
└── sign-service/                FastAPI sign planner
```

## 5. Core User Flows

### Speaker Flow

1. User joins a Google Meet room.
2. BridgeSign injects a role selector.
3. User chooses `Speaker`.
4. Browser speech recognition captures interim and final speech.
5. Transcript lines appear in the BridgeSign toolbar.
6. Caption text is also pushed to the virtual camera subtitle overlay.
7. Finalized speech is relayed to the other participant.
8. Finalized speech is sent to the sign planner.
9. Returned ASL plan is relayed to signer clients.

### Signer Flow

1. User joins the same Google Meet room.
2. User chooses `ASL Signer`.
3. The signer sees the BridgeSign transcript panel.
4. The extension starts browser-side ASL recognition experiments.
5. The extension also scrapes Meet closed captions so the signer can read spoken input.
6. When a sign plan arrives, the ASL playback panel queues and plays it.
7. If no media clip exists for a unit, the UI shows a fallback sign card.

## 6. Feature Inventory

### 6.1 Chrome Extension Features

- Google Meet-only injection through `content_scripts`
- role-based startup: `speaker` or `signer`
- draggable in-meeting toolbar overlay
- transcript list with interim and final caption handling
- transcript download as a text file
- local UI settings:
  - text size
  - caption text color
  - overlay opacity
- persisted overlay position in local extension storage
- room join / leave behavior through a long-lived background port
- popup controls to configure:
  - relay server URL
  - sign planner URL
- connection state reporting in the popup:
  - room
  - role
  - sync status
  - peer count
  - latency badge
- exponential reconnect behavior in the background service worker
- ping / pong latency tracking
- offscreen-document MediaPipe pipeline for hand landmark extraction
- experimental browser ASL recognition:
  - static letters
  - static word gestures
  - dynamic gesture tracking
- ASL playback queue with urgent-message interrupt support
- replay-last-manifest button in signer mode
- Meet closed-caption scraping for signer-side readability
- virtual camera subtitle overlay for speaker preview

### 6.2 Relay Server Features

- room-based WebSocket synchronization
- room isolation by `roomId`
- `JOIN`, `LEAVE`, `CAPTION`, `SIGN_PLAN`, `PING`, `PONG` handling
- room size guardrail via `MAX_ROOM_SIZE`
- message payload cap via `maxPayload`
- simple rate limiting per client
- HTTP health endpoint at `GET /health`
- peer join / peer left notifications
- no database and no transcript persistence

### 6.3 Sign Planner Features

- FastAPI API server
- CORS enabled for local extension access
- static media serving from `/media`
- health endpoint at `GET /health`
- sign plan endpoint at `POST /api/sign-plan`
- phrase-first mapping using a built-in exact phrase library
- token-level mapping for known units
- day-name mapping
- digit mapping
- fingerspelling fallback for unknown words
- urgency detection for messages like `STOP`, `WAIT`, `EMERGENCY`, `CALL-911`
- provider metadata in responses
- optional `sign-language-translator` integration
- provider-selection environment variable:
  - `auto`
  - `slt`
  - `fallback`

### 6.4 Landing Page Features

- static product overview page
- architecture and installation sections
- animated hero mockup
- smooth scrolling
- reveal-on-scroll animations
- copy aligned to the current MVP flow

## 7. Technologies Used

### Frontend / Extension

- Chrome Extension Manifest V3
- JavaScript
- HTML / CSS
- Chrome extension APIs:
  - `storage`
  - `offscreen`
  - `runtime`
  - `tabs`
- Web Speech API:
  - `SpeechRecognition`
  - `webkitSpeechRecognition`
- Canvas API
- `MutationObserver`
- `CustomEvent`
- Google Meet DOM integration

### Computer Vision / Sign Recognition

- MediaPipe Hands
- WebAssembly assets in `libs/`
- offscreen document processing to avoid Meet CSP restrictions
- rule-based hand-pose classification
- motion trajectory heuristics for dynamic signs

### Backend

- Node.js
- `ws` WebSocket library
- built-in Node `http` module
- FastAPI
- Uvicorn
- optional `sign-language-translator`
- Python `unittest`

### Deployment / Infra

- Docker for the relay server
- Railway config for relay deployment
- local filesystem media serving for ASL clips

## 8. Chrome Extension Architecture

### `manifest.json`

Important characteristics:

- `manifest_version: 3`
- background service worker: `background.js`
- Meet-only content scripts
- `virtual-camera.js` runs in `MAIN` world at `document_start`
- other content scripts run at `document_idle`
- host permissions for:
  - `https://meet.google.com/*`
  - `http://172.20.10.8:8001/*`
- CSP allows WASM evaluation for MediaPipe assets

### `background.js`

Responsibilities:

- manages one session per browser tab
- opens WebSocket connections to the relay server
- receives messages from content scripts over a named port
- forwards captions to the relay
- requests sign plans from the FastAPI service for finalized speech
- relays local and remote sign plans back to tabs
- manages reconnect attempts and latency tracking
- creates and monitors the offscreen document for MediaPipe Hands

Message responsibilities:

- content script to background:
  - `JOIN_ROOM`
  - `LEAVE_ROOM`
  - `CAPTION`
  - `GET_STATE`
  - `EXTENSION_ERROR`
- background to content script:
  - `STATE_UPDATE`
  - `REMOTE_CAPTION`
  - `LOCAL_SIGN_PLAN`
  - `REMOTE_SIGN_PLAN`
  - `PEER_JOINED`
  - `PEER_LEFT`

### `content.js`

Responsibilities:

- injects the in-meeting BridgeSign UI
- asks the user to choose a communication role
- renders the transcript panel and signer playback section
- starts speech recognition for speaker mode
- starts ASL recognition for signer mode
- connects to the background service worker over a runtime port
- stores UI settings and overlay position
- supports transcript download

### `virtual-camera.js`

Responsibilities:

- patches `navigator.mediaDevices.getUserMedia`
- draws webcam frames onto a hidden canvas
- overlays caption text on the canvas
- returns a virtualized canvas stream instead of the raw camera stream
- passes through original audio tracks

This means the speaker can preview on-camera subtitles inside Meet.

### `meet-caption-scraper.js`

Responsibilities:

- observes Google Meet DOM mutations
- attempts multiple caption selectors because Meet DOM changes frequently
- extracts speaker/text pairs heuristically
- forwards caption text so signer-side users can read spoken content

This is intentionally heuristic and brittle by nature because it depends on Meet DOM structure.

### `asl-recognition.js`

Responsibilities:

- opens the webcam
- starts the MediaPipe hand-landmark pipeline through the offscreen document
- classifies static hand poses into ASL letters
- detects a few full-word gestures such as `STOP` and `I LOVE YOU`
- builds partial / committed signer text
- emits captions back into the shared transcript flow
- mirrors landmarks and labels into the signer preview panel

Recognized dynamic patterns depend on `motion-tracker.js`.

### `motion-tracker.js`

Responsibilities:

- tracks landmark histories over time
- detects dynamic movement patterns
- supports pattern heuristics for:
  - `HELLO`
  - `YES`
  - `BOOK`
  - `Z`
  - `J`

### `sign-player.js`

Responsibilities:

- mounts the signer playback panel
- queues incoming manifests
- interrupts playback for urgent messages
- loads video clips when URLs exist
- falls back to readable sign cards when clips are missing
- caches clip object URLs
- exposes replay support for the last completed manifest

## 9. Relay Server Architecture

Location: `server/server.js`

Behavior summary:

- runs an HTTP server and WebSocket server on the same port
- creates rooms lazily when the first client joins
- each room stores member socket, role, and ID data
- broadcasts captions and sign plans only to other clients in the same room
- deletes empty rooms automatically

### Relay HTTP Endpoint

`GET /health`

Example response:

```json
{
  "status": "ok",
  "rooms": 1,
  "clients": 2
}
```

### Relay WebSocket Message Types

Client -> server:

- `JOIN`
- `LEAVE`
- `PING`
- `CAPTION`
- `SIGN_PLAN`

Server -> client:

- `ROOM_INFO`
- `PEER_JOINED`
- `PEER_LEFT`
- `CAPTION`
- `SIGN_PLAN`
- `PONG`
- `ERROR`

### Relay Configuration

Environment variables actually used in code:

- `PORT` default `3001`
- `MAX_ROOM_SIZE` default `2`

Implementation note:

- `server/.env.example` also lists `MAX_MESSAGE_SIZE`, but the current server code does not read that variable
- payload size is currently hardcoded through the WebSocket server option `maxPayload: 4096`

## 10. Sign Planner Architecture

Location: `sign-service/`

### `app.py`

Responsibilities:

- defines the FastAPI app
- mounts static media files
- exposes health and planning endpoints
- accepts request payloads with:
  - `text`
  - `sign_language`

### `planner.py`

Responsibilities:

- normalizes and tokenizes input text
- splits text into clauses
- matches exact phrases first
- falls back to per-token mapping
- falls back again to fingerspelling for unknown tokens
- attaches clip URLs if matching media files exist on disk
- marks some outputs as urgent
- reports which provider path produced the plan

### Provider Modes

Controlled by `SIGNFLOW_SIGN_PROVIDER`:

- `auto`: prefer `sign-language-translator`, otherwise fallback
- `slt`: require the library path and fall back with provider error metadata if it fails
- `fallback`: use only the built-in planner

### Built-in Planner Data Sources

The planner currently includes:

- an `EXACT_PHRASE_LIBRARY` for phrase-first matching
- a `UNIT_LIBRARY` for token-level mappings
- a `DAY_LIBRARY`
- a `DIGIT_LIBRARY`
- stopword filtering
- urgency tags

### Media Lookup Rules

Expected media buckets:

- `sign-service/media/asl/phrases/`
- `sign-service/media/asl/fingerspelling/`
- `sign-service/media/asl/days/`
- `sign-service/media/asl/numbers/`

Expected filename conventions:

- phrase clips: lowercase slug IDs such as `can-you-repeat-that.mp4`
- fingerspelling clips: `fs-a.mp4` through `fs-z.mp4`
- numbers: `num-0.mp4` through `num-9.mp4`
- days: `monday.mp4` through `sunday.mp4`

Current repository state:

- those directories exist
- they currently only contain `.gitkeep` placeholders
- the UI therefore relies heavily on fallback sign cards unless clip assets are added

### Sign Planner HTTP Endpoints

`GET /health`

Example response shape:

```json
{
  "status": "ok",
  "service": "sign-planner",
  "media_root": ".../sign-service/media",
  "slt_available": false,
  "slt_import_error": "..."
}
```

`POST /api/sign-plan`

Request:

```json
{
  "text": "Can you repeat that?",
  "sign_language": "ASL"
}
```

Typical response shape:

```json
{
  "text": "Can you repeat that?",
  "sign_language": "ASL",
  "mode": "clips",
  "priority": "normal",
  "units": [
    {
      "type": "clip",
      "id": "CAN-YOU-REPEAT-THAT",
      "duration_ms": 1800,
      "text": "can you repeat that",
      "url": null
    }
  ],
  "provider": "fallback",
  "provider_available": true,
  "provider_reason": "built-in-signflow-planner"
}
```

Possible `mode` values:

- `clips`
- `mixed`
- `fingerspell`

Possible `priority` values:

- `normal`
- `urgent`

## 11. Storage Keys and Configuration

### `chrome.storage.sync`

- `bridgesignServerUrl`
- `bridgesignPlannerUrl`
- `signflowServerUrl` (legacy compatibility)
- `signflowPlannerUrl` (legacy compatibility)

Default values:

- relay: `ws://172.20.10.8:3001`
- planner: `http://172.20.10.8:8001`

### `chrome.storage.local`

- `bridgesignRole`
- `sfSettings`
- `overlayPos`

`sfSettings` currently stores:

- `fontSize`
- `opacity`
- `textColor`

## 12. Setup and Local Development

## Prerequisites

- Google Chrome
- Node.js
- Python 3.11 recommended for planner compatibility

Why Python 3.11 matters:

- `sign-service/README.md` notes that `sign-language-translator` is documented for Python `3.9`, `3.10`, and `3.11`
- the repo also contains a local `sign-service/.venv` using Python `3.11`

### Start the Relay Server

```bash
cd server
npm install
npm start
```

Default:

```text
ws://172.20.10.8:3001
```

### Start the Sign Planner

```bash
cd sign-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 172.20.10.8 --port 8001
```

Default:

```text
http://172.20.10.8:8001
```

### Load the Extension

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select the repository root

### Configure Endpoints

Use the extension popup to set:

- relay server URL
- sign planner URL

### Demo Usage

1. Start both services
2. Load the extension
3. Open Google Meet
4. Join the same room from two browser sessions/devices if testing full relay flow
5. Choose `Speaker` on one side
6. Choose `ASL Signer` on the other side

## 13. Deployment

### Relay Server

The relay server includes:

- `server/Dockerfile`
- `server/railway.toml`

Railway config sets:

- `PORT=3001`
- `MAX_ROOM_SIZE=2`
- health check path `/health`

### Sign Planner

There is no production deployment config for the planner in this repo. It is currently documented and structured as a locally run FastAPI service.

## 14. Testing

Current automated tests exist only for the planner:

- `sign-service/tests/test_planner.py`

Covered behaviors:

- exact phrase match returns a clip-mode plan
- unknown word falls back to fingerspelling
- single-word phrase prefers the phrase sign
- urgent phrase is marked urgent
- provider metadata exists

Notes from verification in this workspace:

- tests are present
- running them from the repo root fails because `test_planner.py` imports `planner` as a top-level module and expects the working directory to be `sign-service/`
- rerunning from `sign-service/` in this environment hit an OpenMP shared-memory error during dependency import, so the suite could not be fully verified here

## 15. Known Constraints and Risks

### Product / Accessibility Constraints

- phrase coverage depends on the manually curated phrase library
- real ASL quality depends on adding validated clip assets
- fallback cards are readable but are not a substitute for true ASL media
- browser speech recognition quality depends on browser and microphone conditions
- browser-side sign recognition is heuristic and experimental

### Technical Constraints

- Google Meet caption scraping depends on unstable DOM selectors
- Web Speech API support varies by browser and platform
- the relay currently defaults to only two users per room
- there is no authentication or access control for rooms
- there is no persistence layer
- the planner imports an optional library that may be sensitive to Python version and environment

### UX Constraints

- signer and speaker roles are mutually selected per session
- some UI state persists locally and may carry across meetings
- virtual camera subtitle behavior depends on Meet requesting the camera through the patched API path

## 16. Current Media and Translation Strategy

This is one of the most important implementation details in the repo:

- BridgeSign does not attempt full free-form ASL generation as its primary path
- it uses phrase-first planning for known, high-value utterances
- it uses token-level mappings for some known words
- it fingerspells unknown words and names
- it shows sign cards when clip files are missing

That design choice makes the MVP predictable and demoable, but it also means system quality is constrained by curation and media coverage.

## 17. Recommended Next Improvements

Highest-value next steps for the project:

- normalize naming so BridgeSign / SignFlow terminology is consistent
- add validated ASL clip assets for the built-in phrase library
- separate experimental browser sign recognition from the core caption-to-playback path
- add authentication or room tokens for the relay
- make room size configurable in extension UI or deployment config
- add planner tests that do not depend on import-path assumptions
- isolate optional `sign-language-translator` import so tests do not fail in unsupported environments
- add production deployment config for the FastAPI planner
- add analytics or structured logging only if privacy requirements are defined first

## 18. Summary

BridgeSign is currently a multi-part Google Meet accessibility prototype with:

- a Chrome extension for in-call UI and role-based behavior
- a Node relay for room synchronization
- a FastAPI service that converts finalized speech into ASL playback manifests
- a phrase-first ASL strategy with fingerspelling fallback
- experimental browser-side ASL recognition using MediaPipe Hands

The most important practical limitation today is that the ASL media folders are present but mostly empty, so much of the signer experience currently depends on fallback cards instead of validated clip playback.

# SignFlow 🤟

**Real-time sign language ↔ speech translation for video calls**

A Chrome extension that enables deaf/hard-of-hearing and hearing participants to communicate seamlessly in Google Meet through real-time ASL recognition and speech-to-text captions.

## Features (MVP)

- 🤟 **ASL → Text**: Fingerspelling recognition via webcam using MediaPipe + TensorFlow.js
- 🗣️ **Speech → Text**: Real-time speech recognition using Web Speech API
- 🔄 **Two-way sync**: Both participants see captions from the other side
- 🎨 **Premium overlay UI**: Glassmorphism caption bar integrated into Google Meet
- 🔌 **Plugin architecture**: Chrome Extension (Manifest V3) — no separate app needed

## Quick Start

### 1. Start the relay server

```bash
cd server
npm install
npm start
```

The WebSocket relay runs on `ws://localhost:3001`.

### 2. Load the Chrome extension

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `ht12` root folder (not `server/`)
5. The SignFlow icon should appear in your toolbar

### 3. Use in Google Meet

1. Open a Google Meet call
2. SignFlow will show a role selector — choose **"I Sign ASL"** or **"I Speak English"**
3. The caption overlay appears at the bottom of the Meet window
4. Invite the other participant to install the extension too

## Architecture

```
┌─────────────────────┐     WebSocket      ┌─────────────────────┐
│  Participant A       │◄──── Relay ───────►│  Participant B       │
│  (Chrome Extension)  │     Server         │  (Chrome Extension)  │
│                      │   (server.js)      │                      │
│  Role: Signer 🤟     │                    │  Role: Speaker 🗣️   │
│  ASL → Text          │                    │  Speech → Text       │
└─────────────────────┘                     └─────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Extension | Chrome Extension (Manifest V3) |
| ASL Recognition | MediaPipe Hands + TensorFlow.js |
| Speech-to-Text | Web Speech API |
| Sync | WebSocket (Node.js + ws) |
| Styling | Vanilla CSS (glassmorphism) |

## Project Structure

```
ht12/
├── manifest.json        # Extension manifest
├── background.js        # Service worker (WebSocket client)
├── content.js           # Meet overlay + recognition logic
├── content.css          # Overlay styles
├── popup/
│   ├── popup.html       # Browser action popup
│   ├── popup.css
│   └── popup.js
├── icons/               # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── models/              # TF.js ASL model (Phase 3)
├── libs/                # MediaPipe + TF.js bundles
└── server/
    ├── package.json
    └── server.js        # WebSocket relay server
```

## Roadmap

- [x] Extension scaffold + overlay UI
- [x] Speech → Text (Web Speech API)
- [x] WebSocket relay server
- [ ] ASL fingerspelling recognition (MediaPipe + TF.js)
- [ ] Performance optimization
- [ ] Full ASL signs (top 100)
- [ ] Zoom + Teams support
- [ ] ASL avatar (text → animated signs)

## License

MIT

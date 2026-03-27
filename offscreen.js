// BridgeSign Offscreen Document
// 1) Runs MediaPipe Hands for ASL recognition (existing)
// 2) Captures tab audio, records chunks, sends to local Whisper server (new)

// ==================== MEDIAPIPE HANDS (existing) ====================
let hands = null;

async function initHands() {
  hands = new window.Hands({
    locateFile: (file) => {
      return chrome.runtime.getURL(`libs/${file}`);
    },
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });

  hands.onResults((results) => {
    chrome.runtime.sendMessage({
      type: 'HAND_LANDMARKS',
      landmarks: results.multiHandLandmarks || []
    });
  });

  await hands.initialize();
  console.log('[BridgeSign Offscreen] MediaPipe Hands initialized.');

  // Notify background we're ready
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });
}

initHands().catch(err => {
  console.error('[BridgeSign Offscreen] Hands init error:', err);
  // Still notify ready so tab capture can work even if Hands fails
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });
});

// ==================== TAB AUDIO CAPTURE + WHISPER ====================
let tabAudioStream = null;
let mediaRecorder = null;
let recordingInterval = null;
let whisperServerUrl = 'http://localhost:8090';
const CHUNK_DURATION_MS = 3000; // Send 3-second audio chunks to Whisper

/**
 * Start capturing tab audio using the stream ID from background.js,
 * record in chunks, and send each chunk to the Whisper server.
 */
async function startTabAudioCapture(streamId, serverUrl) {
  if (tabAudioStream) stopTabAudioCapture();

  whisperServerUrl = (serverUrl || whisperServerUrl).replace(/\/$/, '');

  try {
    // Get the actual MediaStream from the stream ID
    tabAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        },
      },
    });

    console.log('[BridgeSign Offscreen] Tab audio stream acquired');

    // Also play through so the user can still hear the meeting
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(tabAudioStream);
    source.connect(audioCtx.destination);

    // Start chunked recording
    startChunkedRecording();

  } catch (err) {
    console.error('[BridgeSign Offscreen] Failed to capture tab audio:', err);
  }
}

function startChunkedRecording() {
  if (!tabAudioStream) return;

  let audioChunks = [];

  mediaRecorder = new MediaRecorder(tabAudioStream, {
    mimeType: 'audio/webm;codecs=opus',
  });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      audioChunks.push(e.data);
    }
  };

  mediaRecorder.onstop = async () => {
    if (audioChunks.length === 0) return;

    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    audioChunks = [];

    // Send to Whisper server
    await sendToWhisper(blob);
  };

  // Record in chunks
  mediaRecorder.start();

  recordingInterval = setInterval(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      // Restart immediately for the next chunk
      setTimeout(() => {
        if (tabAudioStream && tabAudioStream.active) {
          audioChunks = [];
          mediaRecorder.start();
        }
      }, 50);
    }
  }, CHUNK_DURATION_MS);
}

async function sendToWhisper(audioBlob) {
  try {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'chunk.webm');

    const response = await fetch(`${whisperServerUrl}/api/transcribe`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      console.warn('[BridgeSign Offscreen] Whisper returned', response.status);
      return;
    }

    const result = await response.json();

    if (result.text && result.text.trim()) {
      // Send transcription back to background -> content script
      chrome.runtime.sendMessage({
        type: 'WHISPER_TRANSCRIPT',
        text: result.text.trim(),
        segments: result.segments || [],
      });
    }
  } catch (err) {
    console.warn('[BridgeSign Offscreen] Whisper request failed:', err.message);
  }
}

function stopTabAudioCapture() {
  if (recordingInterval) {
    clearInterval(recordingInterval);
    recordingInterval = null;
  }

  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  mediaRecorder = null;

  if (tabAudioStream) {
    tabAudioStream.getTracks().forEach(t => t.stop());
    tabAudioStream = null;
  }

  console.log('[BridgeSign Offscreen] Tab audio capture stopped');
}

// ==================== MESSAGE LISTENER ====================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // MediaPipe frame processing (existing)
  if (msg.type === 'OFFSCREEN_PROCESS_FRAME') {
    if (hands && msg.dataUrl) {
      const img = new Image();
      img.onload = () => {
        hands.send({ image: img }).catch(console.error);
      };
      img.src = msg.dataUrl;
    }
    return true;
  }

  // Tab audio capture (new)
  if (msg.type === 'OFFSCREEN_START_TAB_AUDIO') {
    startTabAudioCapture(msg.streamId, msg.whisperUrl);
    return false;
  }

  if (msg.type === 'OFFSCREEN_STOP_TAB_AUDIO') {
    stopTabAudioCapture();
    return false;
  }
});

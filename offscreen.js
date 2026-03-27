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

// ==================== MESSAGE LISTENER ====================
let isProcessingFrame = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // MediaPipe frame processing (existing)
  if (msg.type === 'OFFSCREEN_PROCESS_FRAME') {
    if (hands && msg.dataUrl && !isProcessingFrame) {
      isProcessingFrame = true;
      const img = new Image();
      img.onload = async () => {
        try {
          await hands.send({ image: img });
        } catch (err) {
          console.error('[BridgeSign Offscreen] hands.send() error:', err);
        } finally {
          isProcessingFrame = false;
        }
      };
      img.src = msg.dataUrl;
    }
    return true;
  }
});

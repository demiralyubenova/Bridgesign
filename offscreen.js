// BridgeSign Offscreen Document for MediaPipe Hands
// Runs in extension context to bypass strict CSP on Meet pages

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
  console.log('[BridgeSign Offscreen] MediaPipe Hands initialized successfully.');
  
  // Notify background we're ready
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });
}

initHands().catch(err => {
  console.error('[BridgeSign Offscreen] Initialization error:', err);
});

// Listen for incoming video frames as Data URLs
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
});

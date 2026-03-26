// SignFlow Offscreen Document for MediaPipe Hands
// Runs in extension context to bypass strict CSP on Meet pages

let hands = null;

async function initHands() {
  hands = new window.Hands({
    locateFile: (file) => {
      return chrome.runtime.getURL(`libs/${file}`);
    },
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });

  hands.onResults((results) => {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      chrome.runtime.sendMessage({
        type: 'HAND_LANDMARKS',
        landmarks: results.multiHandLandmarks[0]
      });
    } else {
      chrome.runtime.sendMessage({
        type: 'HAND_LANDMARKS',
        landmarks: null
      });
    }
  });

  await hands.initialize();
  console.log('[SignFlow Offscreen] MediaPipe Hands initialized successfully.');
  
  // Notify background we're ready
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' });
}

initHands().catch(err => {
  console.error('[SignFlow Offscreen] Initialization error:', err);
});

// Listen for incoming video frames as Data URLs
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PROCESS_FRAME') {
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

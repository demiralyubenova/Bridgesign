// SignFlow Offscreen Document for MediaPipe Hands
// Runs in extension context to bypass strict CSP on Meet pages

let hands = null;
let isInitialized = false;
let isInitializing = false;
let frameInFlight = false;
let queuedFrameDataUrl = null;
let lastInitError = null;
const DEBUG = false;

function logDebug(...args) {
  if (DEBUG) {
    console.debug('[SignFlow Offscreen]', ...args);
  }
}

function sendRuntimeMessage(message) {
  return chrome.runtime.sendMessage(message).catch(() => {});
}

function reportInitError(error) {
  lastInitError = error && error.message ? error.message : 'Unknown MediaPipe initialization error';
  console.error('[SignFlow Offscreen] Initialization error:', error);
  return sendRuntimeMessage({
    type: 'OFFSCREEN_ERROR',
    error: lastInitError,
  });
}

async function processNextFrame() {
  if (!isInitialized || !hands || frameInFlight || !queuedFrameDataUrl) return;

  const dataUrl = queuedFrameDataUrl;
  queuedFrameDataUrl = null;
  frameInFlight = true;

  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('Failed to decode frame image'));
      img.src = dataUrl;
    });

    await hands.send({ image: img });
  } catch (error) {
    console.error('[SignFlow Offscreen] Frame processing error:', error);
  } finally {
    frameInFlight = false;
    if (queuedFrameDataUrl) {
      processNextFrame();
    }
  }
}

async function initHands() {
  if (isInitialized) return true;
  if (isInitializing) return false;

  isInitializing = true;

  if (!window.Hands) {
    isInitializing = false;
    throw new Error('MediaPipe Hands script did not load');
  }

  try {
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
      sendRuntimeMessage({
        type: 'HAND_LANDMARKS',
        landmarks: results.multiHandLandmarks && results.multiHandLandmarks.length > 0
          ? results.multiHandLandmarks[0]
          : null
      });
    });

    await hands.initialize();

    if (typeof hands.send !== 'function') {
      throw new Error('MediaPipe Hands initialized without a usable send() method');
    }

    isInitialized = true;
    lastInitError = null;
    console.log('[SignFlow Offscreen] MediaPipe Hands initialized successfully.');
    await sendRuntimeMessage({ type: 'OFFSCREEN_READY' });
    logDebug('Offscreen model ready');
    return true;
  } catch (error) {
    hands = null;
    isInitialized = false;
    await reportInitError(error);
    return false;
  } finally {
    isInitializing = false;
  }
}

initHands().catch((error) => {
  reportInitError(error);
});

// Listen for incoming video frames as Data URLs
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OFFSCREEN_PROCESS_FRAME') {
    if (!msg.dataUrl) return false;

    if (!isInitialized) {
      logDebug('Dropping frame before initialization', { initializing: isInitializing, lastInitError });
      return false;
    }

    // Keep only the newest frame so slow inference never builds a stale queue.
    queuedFrameDataUrl = msg.dataUrl;
    processNextFrame();
    return false;
  }
});

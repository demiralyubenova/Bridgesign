// BridgeSign ASL Recognition Module
// Uses MediaPipe Hands for fingerspelling plus a small whole-word gesture layer.

const ASLRecognition = (() => {
  'use strict';

  // ==================== CONFIG ====================
  const CONFIG = {
    CAMERA_WIDTH: 640,
    CAMERA_HEIGHT: 480,
    CONFIDENCE_THRESHOLD: 0.65,
    HOLD_FRAMES: 8,           // Frames to hold a letter before confirming
    WORD_HOLD_FRAMES: 10,     // Static word gestures need a longer hold than letters
    WORD_COOLDOWN_MS: 1600,   // Avoid retriggering the same full-word gesture immediately
    SPACE_TIMEOUT_MS: 1500,   // Pause duration to insert space
    PREDICTION_INTERVAL_MS: 100, // How often to run prediction
    MAX_TEXT_LENGTH: 40,          // Reset subtitle buffer after this many chars
    NUM_LANDMARKS: 21,        // MediaPipe hand landmarks count
    LANDMARK_DIMS: 3,         // x, y, z per landmark
  };

  // ASL Alphabet labels
  const ASL_LABELS = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
    'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
    'U', 'V', 'W', 'X', 'Y', 'Z',
    'space', 'del', 'nothing'
  ];

  // ==================== STATE ====================
  let isActive = false;
  let videoElement = null;
  let ownsVideoElement = false;
  let canvasElement = null;
  let canvasCtx = null;
  let animFrameId = null;
  let onCaptionCallback = null;

  // Letter buffering state
  let currentLetter = null;
  let letterCount = 0;
  let confirmedWord = '';
  let lastLetterTime = Date.now();
  let committedText = '';
  let currentWordGesture = null;
  let wordGestureCount = 0;
  let lastCommittedWordGesture = null;
  let lastCommittedWordTime = 0;

  // ==================== HAND LANDMARK CLASSIFIER ====================
  // Simple rule-based ASL fingerspelling classifier using MediaPipe landmarks
  // This avoids needing a separate TF.js model for the MVP
  // Accuracy: ~70-85% for clear, front-facing fingerspelling

  function analyzeHandPose(landmarks) {
    if (!landmarks || landmarks.length < 21) return null;

    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const thumbIP = landmarks[3];
    const indexTip = landmarks[8];
    const indexDIP = landmarks[7];
    const indexPIP = landmarks[6];
    const indexMCP = landmarks[5];
    const middleTip = landmarks[12];
    const middlePIP = landmarks[10];
    const middleMCP = landmarks[9];
    const ringTip = landmarks[16];
    const ringPIP = landmarks[14];
    const ringMCP = landmarks[13];
    const pinkyTip = landmarks[20];
    const pinkyPIP = landmarks[18];
    const pinkyMCP = landmarks[17];

    function isExtended(tip, pip) { return tip.y < pip.y - 0.02; }
    function isCurled(tip, mcp) { return tip.y > mcp.y - 0.01; }
    function isPointingForward(tip, mcp) { return tip.z < mcp.z - 0.03 && Math.abs(tip.y - mcp.y) < 0.05; }
    function isPointingDown(tip, mcp) { return tip.y > mcp.y + 0.03; }
    function dist(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2); }

    const indexExtended = isExtended(indexTip, indexPIP);
    const middleExtended = isExtended(middleTip, middlePIP);
    const ringExtended = isExtended(ringTip, ringPIP);
    const pinkyExtended = isExtended(pinkyTip, pinkyPIP);
    const thumbExtended = Math.abs(thumbTip.x - thumbIP.x) > 0.04;

    const indexCurled = isCurled(indexTip, indexMCP);
    const middleCurled = isCurled(middleTip, middleMCP);
    const ringCurled = isCurled(ringTip, ringMCP);
    const pinkyCurled = isCurled(pinkyTip, pinkyMCP);

    return {
      wrist,
      thumbTip,
      thumbIP,
      indexTip,
      indexDIP,
      indexPIP,
      indexMCP,
      middleTip,
      middlePIP,
      middleMCP,
      ringTip,
      ringPIP,
      ringMCP,
      pinkyTip,
      pinkyPIP,
      pinkyMCP,
      indexExtended,
      middleExtended,
      ringExtended,
      pinkyExtended,
      thumbExtended,
      indexCurled,
      middleCurled,
      ringCurled,
      pinkyCurled,
      isHandPointingDown: indexTip.y > wrist.y && middleTip.y > wrist.y,
      thumbToIndexDist: dist(thumbTip, indexTip),
      palmWidth: dist(indexMCP, pinkyMCP),
      fingertipSpread: dist(indexTip, pinkyTip),
      fingerFan: dist(indexTip, middleTip) + dist(middleTip, ringTip) + dist(ringTip, pinkyTip),
      dist,
      isPointingForward,
      isPointingDown,
    };
  }

  function classifyHandLandmarks(landmarks) {
    const pose = analyzeHandPose(landmarks);
    if (!pose) return { letter: 'nothing', confidence: 0 };

    const {
      thumbTip,
      indexTip,
      indexDIP,
      indexPIP,
      indexMCP,
      middleTip,
      middlePIP,
      middleMCP,
      ringTip,
      ringPIP,
      ringMCP,
      pinkyTip,
      pinkyPIP,
      pinkyMCP,
      indexExtended,
      middleExtended,
      ringExtended,
      pinkyExtended,
      thumbExtended,
      indexCurled,
      middleCurled,
      isHandPointingDown,
      thumbToIndexDist,
      dist,
      isPointingForward,
      isPointingDown,
    } = pose;

    // 1. F: OK sign but three fingers up
    if (thumbToIndexDist < 0.04 && middleExtended && ringExtended && pinkyExtended) return { letter: 'F', confidence: 0.78 };
    // 2. O: Fingers and thumb form circle
    if (thumbToIndexDist < 0.04 && !middleExtended && !ringExtended && !pinkyExtended) return { letter: 'O', confidence: 0.75 };
    // 3. B: All 4 fingers up
    if (indexExtended && middleExtended && ringExtended && pinkyExtended) return { letter: 'B', confidence: 0.78 };
    // 4. W: 3 fingers up
    if (indexExtended && middleExtended && ringExtended && !pinkyExtended) return { letter: 'W', confidence: 0.82 };
    // 5. R: Index and middle crossed
    if (indexExtended && middleExtended && !ringExtended && !pinkyExtended) {
      if (dist(indexTip, middleTip) < 0.03 && (indexTip.x < middleTip.x || indexTip.x > middleTip.x)) {
        return { letter: 'R', confidence: 0.75 };
      }
    }
    // 6. V: 2 spread fingers
    if (indexExtended && middleExtended && !ringExtended && !pinkyExtended && dist(indexTip, middleTip) > 0.04) return { letter: 'V', confidence: 0.85 };
    // 7. U: 2 fingers together
    if (indexExtended && middleExtended && !ringExtended && !pinkyExtended && dist(indexTip, middleTip) <= 0.04) return { letter: 'U', confidence: 0.82 };
    // 8. K: 2 fingers + thumb between
    if (indexExtended && middleExtended && !ringExtended && !pinkyExtended && thumbTip.y < indexMCP.y && thumbTip.y > indexPIP.y) return { letter: 'K', confidence: 0.70 };
    // 9. H: 2 fingers pointing forward
    if (!ringExtended && !pinkyExtended && isPointingForward(indexTip, indexMCP) && isPointingForward(middleTip, middleMCP)) return { letter: 'H', confidence: 0.72 };
    // 10. D: 1 finger up + thumb touches middle
    if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended && dist(thumbTip, middleTip) < 0.06) return { letter: 'D', confidence: 0.80 };
    // 11. L: 1 finger up + thumb out
    if (indexExtended && thumbExtended && !middleExtended && !ringExtended && !pinkyExtended) return { letter: 'L', confidence: 0.82 };
    // 12. G: 1 finger pointing forward
    if (!middleExtended && !ringExtended && !pinkyExtended && isPointingForward(indexTip, indexMCP)) return { letter: 'G', confidence: 0.70 };
    // 13. X: 1 finger hooked
    if (!middleExtended && !ringExtended && !pinkyExtended && indexTip.y > indexDIP.y && indexTip.y < indexMCP.y) return { letter: 'X', confidence: 0.75 };
    // 14. I: pinky only
    if (!indexExtended && !middleExtended && !ringExtended && pinkyExtended && !thumbExtended) return { letter: 'I', confidence: 0.82 };
    // 15. Y: pinky + thumb out
    if (!indexExtended && !middleExtended && !ringExtended && pinkyExtended && thumbExtended) return { letter: 'Y', confidence: 0.85 };
    // 16. P: K-shape pointing down
    if (isHandPointingDown && !ringExtended && !pinkyExtended && dist(indexTip, middleTip) > 0.03) return { letter: 'P', confidence: 0.70 };
    // 17. Q: G-shape pointing down
    if (isHandPointingDown && !middleExtended && !ringExtended && !pinkyExtended && isPointingDown(indexTip, indexMCP)) return { letter: 'Q', confidence: 0.70 };
    // 18. C: Curved hand (partial curl)
    if (!indexExtended && !indexCurled && !middleExtended && !middleCurled && thumbToIndexDist > 0.08 && thumbToIndexDist < 0.18) return { letter: 'C', confidence: 0.68 };

    // 19-24: Fists.
    if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
      const distToFingers = (dist(thumbTip, indexTip) + dist(thumbTip, middleTip) + dist(thumbTip, ringTip)) / 3;
      if (distToFingers < 0.04) return { letter: 'E', confidence: 0.75 };
      
      const thumbXCenterDistance = Math.abs(thumbTip.x - indexMCP.x);
      if (thumbXCenterDistance > 0.04) return { letter: 'A', confidence: 0.75 }; // Thumb to side
      
      if (thumbTip.y > indexPIP.y) return { letter: 'S', confidence: 0.72 }; // Thumb over fingers
      
      if (thumbTip.x > indexMCP.x && thumbTip.x < middleMCP.x) return { letter: 'T', confidence: 0.65 }; // Between index/middle
      if (thumbTip.x > indexPIP.x && thumbTip.x < ringPIP.x && thumbTip.y > indexPIP.y) return { letter: 'N', confidence: 0.65 }; // Under 2
      if (thumbTip.x > indexPIP.x && thumbTip.x < pinkyPIP.x && thumbTip.y > indexPIP.y) return { letter: 'M', confidence: 0.65 }; // Under 3
    }

    return { letter: 'nothing', confidence: 0.3 };
  }

  function classifyWordGesture(landmarks) {
    const pose = analyzeHandPose(landmarks);
    if (!pose) return { word: null, confidence: 0 };

    const {
      wrist,
      indexMCP,
      indexExtended,
      middleExtended,
      ringExtended,
      pinkyExtended,
      thumbExtended,
      thumbToIndexDist,
      fingertipSpread,
      palmWidth,
      fingerFan,
    } = pose;

    const allFingersExtended = indexExtended && middleExtended && ringExtended && pinkyExtended;
    const isStopPalm = allFingersExtended
      && thumbExtended
      && thumbToIndexDist > 0.09
      && fingertipSpread > palmWidth * 1.35
      && fingerFan > 0.16
      && wrist.y > indexMCP.y;

    if (isStopPalm) {
      return { word: 'STOP', confidence: 0.9 };
    }

    const isILY = indexExtended
      && !middleExtended
      && !ringExtended
      && pinkyExtended
      && thumbExtended;

    if (isILY) {
      return { word: 'I LOVE YOU', confidence: 0.95 };
    }

    return { word: null, confidence: 0 };
  }

  // ==================== WEBCAM ====================
  async function initializeCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: CONFIG.CAMERA_WIDTH },
          height: { ideal: CONFIG.CAMERA_HEIGHT },
          facingMode: 'user',
        },
      });

      videoElement = document.createElement('video');
      videoElement.srcObject = stream;
      videoElement.autoplay = true;
      videoElement.playsInline = true;
      videoElement.muted = true;
      videoElement.style.display = 'none';
      document.body.appendChild(videoElement);
      ownsVideoElement = true;

      canvasElement = document.createElement('canvas');
      canvasElement.width = CONFIG.CAMERA_WIDTH;
      canvasElement.height = CONFIG.CAMERA_HEIGHT;
      canvasElement.style.display = 'none';
      document.body.appendChild(canvasElement);
      canvasCtx = canvasElement.getContext('2d');

      await videoElement.play();
      return true;
    } catch (err) {
      console.error('[BridgeSign ASL] Camera access failed:', err);
      return false;
    }
  }

  // ==================== MEDIAPIPE HANDS ====================
  async function initializeMediaPipe() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'START_OFFSCREEN' }, (response) => {
        resolve(Boolean(response && response.success));
      });
    });
  }

  async function setupHands() {
    // Listen for landmarks from offscreen document
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'HAND_LANDMARKS' && isActive) {
        const multiHandLandmarks = Array.isArray(msg.landmarks)
          ? (Array.isArray(msg.landmarks[0]) ? msg.landmarks : [])
          : [];
        onHandResults({ multiHandLandmarks });
      }
    });
  }

  // ==================== INFERENCE LOOP ====================
  function onHandResults(results) {
    if (!isActive) return;

    let detectedToken = null;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const handLandmarks = results.multiHandLandmarks.filter(
        (hand) => Array.isArray(hand) && hand.length >= 21
      );
      const primaryLandmarks = selectPrimaryHand(handLandmarks);
      
      let handWasHandled = false;

      // Check dynamic gestures first because they rely on movement across frames.
      if (window.MotionTracker) {
        const motionMatch = window.MotionTracker.track(handLandmarks);
        if (motionMatch.token && motionMatch.confidence >= CONFIG.CONFIDENCE_THRESHOLD) {
          detectedToken = motionMatch.token;
          if (motionMatch.kind === 'word') {
            processWordGesture(motionMatch.token, true);
          } else {
            processLetter(motionMatch.token);
          }
          handWasHandled = true;
        }
      }

      if (!handWasHandled && primaryLandmarks) {
        const wordGesture = classifyWordGesture(primaryLandmarks);
        if (wordGesture.word && wordGesture.confidence >= CONFIG.CONFIDENCE_THRESHOLD) {
          detectedToken = wordGesture.word;
          processWordGesture(wordGesture.word, false);
          handWasHandled = true;
        }
      }

      if (!handWasHandled && primaryLandmarks) {
        const classification = classifyHandLandmarks(primaryLandmarks);
        if (classification.confidence >= CONFIG.CONFIDENCE_THRESHOLD) {
          detectedToken = classification.letter;
          processLetter(classification.letter);
        } else {
          processLetter('nothing');
        }
      } else if (!primaryLandmarks) {
        processLetter('nothing');
      }

      drawLandmarksOnCanvas(handLandmarks, detectedToken);
    } else {
      processLetter('nothing');
      drawLandmarksOnCanvas(null, null);
    }
  }

  function selectPrimaryHand(hands) {
    if (!hands || hands.length === 0) return null;
    return hands
      .slice()
      .sort((a, b) => estimateHandSize(b) - estimateHandSize(a))[0];
  }

  function getBestMeetVideoElement() {
    const videos = Array.from(document.querySelectorAll('video'));
    let bestVideo = null;
    let bestScore = -1;

    for (const candidate of videos) {
      if (!(candidate instanceof HTMLVideoElement)) continue;
      if (candidate.readyState < 2) continue;

      const rect = candidate.getBoundingClientRect();
      const style = window.getComputedStyle(candidate);
      if (rect.width < 120 || rect.height < 90) continue;
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) continue;

      const areaScore = rect.width * rect.height;
      const cornerBias = rect.left > window.innerWidth * 0.55 && rect.top > window.innerHeight * 0.55 ? 50000 : 0;
      const score = areaScore + cornerBias;

      if (score > bestScore) {
        bestScore = score;
        bestVideo = candidate;
      }
    }

    return bestVideo;
  }

  function estimateHandSize(landmarks) {
    if (!landmarks || landmarks.length < 21) return 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const point of landmarks) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }

    return (maxX - minX) * (maxY - minY);
  }

  function drawLandmarksOnCanvas(handSets, detectedToken) {
    const canvas = document.getElementById('sf-pip-canvas');
    const label = document.getElementById('sf-pip-label');
    const container = document.getElementById('sf-pip-container');
    
    if (!canvas || !container) return;
    if (!isActive) {
      container.style.display = 'none';
      return;
    }
    container.style.display = 'block';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (videoElement && videoElement.readyState >= 2) {
      ctx.save();
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }

    if (label) {
      label.textContent = (detectedToken && detectedToken !== 'nothing') ? detectedToken : '-';
    }

    if (!handSets || handSets.length === 0) return;

    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);

    const w = canvas.width;
    const h = canvas.height;
    const connections = [
      [0,1], [1,2], [2,3], [3,4],
      [0,5], [5,6], [6,7], [7,8],
      [5,9], [9,10], [10,11], [11,12],
      [9,13], [13,14], [14,15], [15,16],
      [13,17], [0,17], [17,18], [18,19], [19,20]
    ];

    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 2;
    for (const landmarks of handSets) {
      for (const [i, j] of connections) {
        const p1 = landmarks[i];
        const p2 = landmarks[j];
        ctx.beginPath();
        ctx.moveTo(p1.x * w, p1.y * h);
        ctx.lineTo(p2.x * w, p2.y * h);
        ctx.stroke();
      }

      ctx.fillStyle = '#ef4444';
      for (const p of landmarks) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 3, 0, 2 * Math.PI);
        ctx.fill();
      }
    }    
    ctx.restore();
  }

  function resetWordGestureState() {
    currentWordGesture = null;
    wordGestureCount = 0;
  }

  function appendCommittedToken(token) {
    if (!token) return;
    committedText = committedText ? `${committedText} ${token}` : token;
  }

  function buildCurrentText() {
    if (committedText && confirmedWord) {
      return `${committedText} ${confirmedWord}`;
    }
    return committedText || confirmedWord;
  }

  function commitSpelledWord() {
    if (!confirmedWord) return false;
    appendCommittedToken(confirmedWord);
    confirmedWord = '';
    return true;
  }

  function commitRecognizedWord(word) {
    commitSpelledWord();
    appendCommittedToken(word);
    lastCommittedWordGesture = word;
    lastCommittedWordTime = Date.now();
    resetWordGestureState();
    currentLetter = null;
    letterCount = 0;
    emitBufferedCaption(false);
  }

  function processWordGesture(word, immediate) {
    if (!word) {
      resetWordGestureState();
      return;
    }

    const now = Date.now();
    if (
      word === lastCommittedWordGesture
      && now - lastCommittedWordTime < CONFIG.WORD_COOLDOWN_MS
    ) {
      return;
    }

    if (immediate) {
      commitRecognizedWord(word);
      return;
    }

    if (word === currentWordGesture) {
      wordGestureCount++;
      if (wordGestureCount >= CONFIG.WORD_HOLD_FRAMES) {
        commitRecognizedWord(word);
      }
      return;
    }

    currentWordGesture = word;
    wordGestureCount = 1;
  }

  function processLetter(letter) {
    resetWordGestureState();
    const now = Date.now();

    if (letter === 'nothing' || letter === 'del' || letter === 'space') {
      if (letter === 'nothing' && now - lastLetterTime > CONFIG.SPACE_TIMEOUT_MS && confirmedWord.length > 0) {
        commitSpelledWord();
        emitBufferedCaption(false);
      }
      if (letter === 'space' && commitSpelledWord()) {
        emitBufferedCaption(false);
      }
      if (letter === 'del' && confirmedWord.length > 0) {
        confirmedWord = confirmedWord.slice(0, -1);
        emitCaption(buildCurrentText(), true);
      }
      currentLetter = null;
      letterCount = 0;
      return;
    }

    // Auto-space after timeout
    if (now - lastLetterTime > CONFIG.SPACE_TIMEOUT_MS && confirmedWord.length > 0) {
      commitSpelledWord();
      emitBufferedCaption(false);
    }

    if (letter === currentLetter) {
      letterCount++;
      if (letterCount === CONFIG.HOLD_FRAMES) {
        confirmedWord += letter;
        lastLetterTime = now;
        letterCount = 0;
        emitBufferedCaption(true);
      }
    } else {
      currentLetter = letter;
      letterCount = 1;
    }
  }

  function emitBufferedCaption(partial) {
    const total = buildCurrentText().trim();
    if (!total) return;

    if (!partial || total.length >= CONFIG.MAX_TEXT_LENGTH) {
      emitCaption(total, false);
      committedText = '';
      confirmedWord = '';
    } else {
      emitCaption(total, partial);
    }
  }

  function emitCaption(text, partial) {
    if (onCaptionCallback) {
      onCaptionCallback(text, partial);
    }
  }

  async function startProcessingLoop() {
    if (!isActive || !videoElement) return;

    const processCanvas = document.createElement('canvas');
    processCanvas.width = Math.floor(CONFIG.CAMERA_WIDTH / 2);
    processCanvas.height = Math.floor(CONFIG.CAMERA_HEIGHT / 2);
    const processCtx = processCanvas.getContext('2d');

    async function processFrame() {
      if (!isActive) return;

      if (videoElement.readyState >= 2) {
        processCtx.drawImage(videoElement, 0, 0, processCanvas.width, processCanvas.height);
        const dataUrl = processCanvas.toDataURL('image/webp', 0.5);
        chrome.runtime.sendMessage({ 
          type: 'PROCESS_FRAME', 
          dataUrl: dataUrl 
        });
      }

      if (isActive) {
        animFrameId = setTimeout(processFrame, CONFIG.PREDICTION_INTERVAL_MS);
      }
    }

    processFrame();
  }

  // ==================== PUBLIC API ====================
  async function start(captionCallback) {
    if (isActive) return;

    onCaptionCallback = captionCallback;
    isActive = true;

    // Reset state
    currentLetter = null;
    letterCount = 0;
    confirmedWord = '';
    committedText = '';
    currentWordGesture = null;
    wordGestureCount = 0;
    lastCommittedWordGesture = null;
    lastCommittedWordTime = 0;
    lastLetterTime = Date.now();
    ownsVideoElement = false;

    try {
      // Step 1: Initialize camera
      const cameraOk = await initializeCamera();
      if (!cameraOk) {
        console.warn('[BridgeSign] Dedicated camera failed, attempting to hijack Meet video element');
        const meetVideo = getBestMeetVideoElement();
        if (meetVideo) {
          videoElement = meetVideo;
        } else {
          throw new Error('Camera locked by Windows and no active Meet video found');
        }
      }

      // Step 2: Load MediaPipe
      const offscreenReady = await initializeMediaPipe();
      if (!offscreenReady) {
        throw new Error('Offscreen hand tracker failed to initialize');
      }

      // Step 3: Setup Hands model
      await setupHands();

      // Step 4: Start processing loop
      await startProcessingLoop();

      return true;
    } catch (err) {
      console.error('[BridgeSign ASL] Failed to start:', err);
      isActive = false;
      return err.message;
    }
  }

  function stop() {
    isActive = false;

    if (animFrameId) {
      clearTimeout(animFrameId);
      animFrameId = null;
    }

    if (videoElement) {
      if (ownsVideoElement && videoElement.srcObject) {
        videoElement.srcObject.getTracks().forEach((t) => t.stop());
        videoElement.remove();
      }
      videoElement = null;
    }

    if (canvasElement) {
      canvasElement.remove();
      canvasElement = null;
    }
    
    const container = document.getElementById('sf-pip-container');
    if (container) {
      container.style.display = 'none';
    }

    onCaptionCallback = null;
  }

  function isRunning() {
    return isActive;
  }

  return { start, stop, isRunning };
})();

// Export for content script
if (typeof window !== 'undefined') {
  window.ASLRecognition = ASLRecognition;
}

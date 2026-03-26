// SignFlow ASL Fingerspelling Recognition Module
// Uses MediaPipe Hands for landmark detection + a classifier for ASL alphabet

const ASLRecognition = (() => {
  'use strict';

  // ==================== CONFIG ====================
  const CONFIG = {
    CAMERA_WIDTH: 640,
    CAMERA_HEIGHT: 480,
    CONFIDENCE_THRESHOLD: 0.65,
    WEAK_CONFIDENCE_THRESHOLD: 0.55,
    HOLD_FRAMES: 8,           // Frames to hold a letter before confirming
    SPACE_TIMEOUT_MS: 1500,   // Pause duration to insert space
    PREDICTION_INTERVAL_MS: 120, // How often to attempt sending a frame
    SMOOTHING_WINDOW: 7,
    SMOOTHING_MIN_VOTES: 4,
    NO_HAND_STABLE_FRAMES: 2,
    HAND_MISSING_GRACE_MS: 250,
    LETTER_RELEASE_MS: 650,
    CONFIRMATION_COOLDOWN_MS: 900,
    PROCESS_FRAME_WIDTH: 448,
    IMAGE_QUALITY: 0.6,
    FRAME_RESULT_TIMEOUT_MS: 350,
    WORD_CONFIDENCE_THRESHOLD: 0.8,
    NUM_LANDMARKS: 21,        // MediaPipe hand landmarks count
    LANDMARK_DIMS: 3,         // x, y, z per landmark
  };
  const DEBUG = false;

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
  let canvasElement = null;
  let canvasCtx = null;
  let animFrameId = null;
  let onCaptionCallback = null;
  let handsMessageListener = null;
  let awaitingFrameResult = false;
  let lastFrameSentAt = 0;

  // Letter buffering state
  let currentCandidate = null;
  let stableFrames = 0;
  let lastConfirmedLetter = null;
  let confirmationCooldownUntil = 0;
  let awaitingRelease = false;
  let currentWord = '';
  let lastLetterTime = Date.now();
  let fullSentence = '';
  let handMissingSince = null;
  let lastEmittedText = '';
  let lastEmitWasPartial = null;
  let predictionHistory = [];
  let noHandFrameCount = 0;

  // ==================== HAND LANDMARK CLASSIFIER ====================
  // Simple rule-based ASL fingerspelling classifier using MediaPipe landmarks
  // This avoids needing a separate TF.js model for the MVP
  // Accuracy: ~70-85% for clear, front-facing fingerspelling

  function classifyHandLandmarks(landmarks) {
    if (!landmarks || landmarks.length < 21) return { letter: 'nothing', confidence: 0 };

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
    const pinkyTip = landmarks[20];
    const pinkyPIP = landmarks[18];
    const pinkyMCP = landmarks[17];

    function dist(a, b) {
      return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
    }
    function between(v, min, max) {
      return v >= min && v <= max;
    }
    function xBetween(x, a, b) {
      const minX = Math.min(a, b);
      const maxX = Math.max(a, b);
      return x > minX && x < maxX;
    }

    // Normalize distances by palm size so thresholds are less camera-distance dependent.
    const palmWidth = dist(indexMCP, pinkyMCP);
    const palmHeight = dist(wrist, middleMCP);
    const handScale = Math.max((palmWidth + palmHeight) / 2, 0.05);
    const nDist = (a, b) => dist(a, b) / handScale;
    const deltaY = (a, b) => (a.y - b.y) / handScale;
    const deltaZ = (a, b) => (a.z - b.z) / handScale;

    function isExtended(tip, pip) { return deltaY(pip, tip) > 0.2; }
    function isCurled(tip, mcp) { return deltaY(tip, mcp) > -0.06; }
    function isPointingForward(tip, mcp) {
      return deltaZ(mcp, tip) > 0.24 && Math.abs(deltaY(tip, mcp)) < 0.45;
    }
    function isPointingDown(tip, mcp) { return deltaY(tip, mcp) > 0.24; }

    const indexExtended = isExtended(indexTip, indexPIP);
    const middleExtended = isExtended(middleTip, middlePIP);
    const ringExtended = isExtended(ringTip, ringPIP);
    const pinkyExtended = isExtended(pinkyTip, pinkyPIP);
    const thumbExtended = Math.abs((thumbTip.x - thumbIP.x) / handScale) > 0.32;

    const indexCurled = isCurled(indexTip, indexMCP);
    const middleCurled = isCurled(middleTip, middleMCP);

    const fistShape = !indexExtended && !middleExtended && !ringExtended && !pinkyExtended;
    const twoFingerShape = indexExtended && middleExtended && !ringExtended && !pinkyExtended;
    const oneFingerShape = indexExtended && !middleExtended && !ringExtended && !pinkyExtended;
    const isHandPointingDown = indexTip.y > wrist.y && middleTip.y > wrist.y;
    const thumbToIndexNorm = nDist(thumbTip, indexTip);
    const thumbToMiddleNorm = nDist(thumbTip, middleTip);
    const thumbToRingNorm = nDist(thumbTip, ringTip);
    const indexMiddleGapNorm = nDist(indexTip, middleTip);

    // Family 1: open hand shapes.
    if (indexExtended && middleExtended && ringExtended && pinkyExtended) {
      if (thumbToIndexNorm < 0.42) return { letter: 'F', confidence: 0.8 };
      return { letter: 'B', confidence: 0.78 };
    }
    if (indexExtended && middleExtended && ringExtended && !pinkyExtended) {
      return { letter: 'W', confidence: 0.82 };
    }
    if (!indexExtended && !indexCurled && !middleExtended && !middleCurled && between(thumbToIndexNorm, 0.75, 1.55)) {
      return { letter: 'C', confidence: 0.7 };
    }

    // Family 2: two-finger shapes (tightened U/V/R and H/P).
    if (twoFingerShape) {
      const crossed = (indexTip.x - middleTip.x) * (indexPIP.x - middlePIP.x) < 0;
      if (crossed && indexMiddleGapNorm < 0.42) return { letter: 'R', confidence: 0.8 };
      if (indexMiddleGapNorm >= 0.5) return { letter: 'V', confidence: 0.85 };
      if (indexMiddleGapNorm < 0.34) return { letter: 'U', confidence: 0.83 };
      if (isPointingForward(indexTip, indexMCP) && isPointingForward(middleTip, middleMCP)) return { letter: 'H', confidence: 0.74 };
      if (
        isHandPointingDown &&
        indexMiddleGapNorm > 0.34 &&
        thumbTip.y < indexMCP.y &&
        thumbTip.y > indexPIP.y
      ) {
        return { letter: 'P', confidence: 0.72 };
      }
      if (thumbTip.y < indexMCP.y && thumbTip.y > indexPIP.y) return { letter: 'K', confidence: 0.71 };
    }

    // Family 3: thumb-dependent shapes (L, Y, O, D).
    if (thumbToIndexNorm < 0.42 && !middleExtended && !ringExtended && !pinkyExtended) {
      return { letter: 'O', confidence: 0.76 };
    }
    if (oneFingerShape && thumbToMiddleNorm < 0.9) return { letter: 'D', confidence: 0.8 };
    if (oneFingerShape && thumbExtended) return { letter: 'L', confidence: 0.82 };
    if (!indexExtended && !middleExtended && !ringExtended && pinkyExtended) {
      if (thumbExtended) return { letter: 'Y', confidence: 0.85 };
      return { letter: 'I', confidence: 0.82 };
    }

    // Family 4: forward/down one-finger shapes (tightened G/Q competition).
    if (oneFingerShape && isPointingForward(indexTip, indexMCP)) return { letter: 'G', confidence: 0.72 };
    if (
      !middleExtended &&
      !ringExtended &&
      !pinkyExtended &&
      isHandPointingDown &&
      isPointingDown(indexTip, indexMCP) &&
      thumbExtended
    ) {
      return { letter: 'Q', confidence: 0.73 };
    }
    if (!middleExtended && !ringExtended && !pinkyExtended && indexTip.y > indexDIP.y && indexTip.y < indexMCP.y) {
      return { letter: 'X', confidence: 0.75 };
    }

    // Family 5: fist shapes (tightened A/E/S and M/N/T competition).
    if (fistShape) {
      const thumbCluster = (thumbToIndexNorm + thumbToMiddleNorm + thumbToRingNorm) / 3;
      const thumbOnKnuckles = thumbTip.y > indexPIP.y;
      const thumbSideOffset = Math.abs((thumbTip.x - indexMCP.x) / handScale);
      const thumbUnderIndexMiddle = xBetween(thumbTip.x, indexPIP.x, middlePIP.x) && thumbOnKnuckles;
      const thumbUnderIndexRing = xBetween(thumbTip.x, indexPIP.x, ringPIP.x) && thumbOnKnuckles;
      const thumbUnderIndexPinky = xBetween(thumbTip.x, indexPIP.x, pinkyPIP.x) && thumbOnKnuckles;

      if (thumbCluster < 0.55) return { letter: 'E', confidence: 0.78 };
      if (thumbUnderIndexMiddle) return { letter: 'T', confidence: 0.7 };
      if (thumbUnderIndexRing && !thumbUnderIndexMiddle) return { letter: 'N', confidence: 0.69 };
      if (thumbUnderIndexPinky && !thumbUnderIndexRing) return { letter: 'M', confidence: 0.68 };
      if (thumbOnKnuckles && thumbCluster < 0.85) return { letter: 'S', confidence: 0.74 };
      if (thumbSideOffset > 0.34) return { letter: 'A', confidence: 0.75 };
    }

    return { letter: 'nothing', confidence: 0.3 };
  }

  function smoothPrediction(rawLetter, confidence, hasHand) {
    if (!hasHand) {
      predictionHistory = [];
      noHandFrameCount++;
      if (noHandFrameCount >= CONFIG.NO_HAND_STABLE_FRAMES) {
        return 'no_hand';
      }
      return null;
    }

    noHandFrameCount = 0;

    const acceptedRaw = rawLetter && confidence >= CONFIG.WEAK_CONFIDENCE_THRESHOLD ? rawLetter : null;
    predictionHistory.push(acceptedRaw);
    if (predictionHistory.length > CONFIG.SMOOTHING_WINDOW) {
      predictionHistory.shift();
    }

    const counts = new Map();
    for (const value of predictionHistory) {
      if (!value || value === 'nothing') continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }

    let bestLetter = null;
    let bestCount = 0;
    let secondBest = 0;
    for (const [letter, count] of counts.entries()) {
      if (count > bestCount) {
        secondBest = bestCount;
        bestLetter = letter;
        bestCount = count;
      } else if (count > secondBest) {
        secondBest = count;
      }
    }

    if (!bestLetter) return null;
    if (bestCount < CONFIG.SMOOTHING_MIN_VOTES) return null;
    if (bestCount <= secondBest) return null;
    if (predictionHistory[predictionHistory.length - 1] !== bestLetter) return null;
    if (bestLetter === 'nothing') return null;

    return bestLetter;
  }

  function logDebug(...args) {
    if (DEBUG) {
      console.debug('[SignFlow ASL]', ...args);
    }
  }

  // ==================== WEBCAM ====================
  async function initializeCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
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

      canvasElement = document.createElement('canvas');
      canvasElement.width = CONFIG.CAMERA_WIDTH;
      canvasElement.height = CONFIG.CAMERA_HEIGHT;
      canvasElement.style.display = 'none';
      document.body.appendChild(canvasElement);
      canvasCtx = canvasElement.getContext('2d');

      await videoElement.play();
      return true;
    } catch (err) {
      console.error('[SignFlow ASL] Camera access failed:', err);
      return false;
    }
  }

  // ==================== MEDIAPIPE HANDS ====================
  async function initializeMediaPipe() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'START_OFFSCREEN' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('[SignFlow ASL] Offscreen startup message failed:', chrome.runtime.lastError.message);
          resolve(false);
          return;
        }
        if (response && response.error) {
          console.error('[SignFlow ASL] Offscreen startup failed:', response.error);
        }
        resolve(Boolean(response && response.success));
      });
    });
  }

  async function setupHands() {
    if (handsMessageListener) return;

    // Listen for landmarks from offscreen document
    handsMessageListener = (msg) => {
      if (msg.type === 'HAND_LANDMARKS' && isActive) {
        onHandResults({ multiHandLandmarks: msg.landmarks ? [msg.landmarks] : [] });
      }
    };

    chrome.runtime.onMessage.addListener(handsMessageListener);
    logDebug('Attached HAND_LANDMARKS listener');
  }

  function teardownHands() {
    if (!handsMessageListener) return;

    chrome.runtime.onMessage.removeListener(handsMessageListener);
    handsMessageListener = null;
    logDebug('Removed HAND_LANDMARKS listener');
  }

  // ==================== INFERENCE LOOP ====================
  function onHandResults(results) {
    if (!isActive) return;

    awaitingFrameResult = false;
    let detectedLabel = null;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];

      noHandFrameCount = 0;
      let handWasClassified = false;
      let rawLetter = null;
      let rawConfidence = 0;
      let detectedWord = null;
      const now = Date.now();
      if (window.WordRecognition) {
        const wordMatch = window.WordRecognition.track(landmarks);
        if (wordMatch.word && wordMatch.confidence >= CONFIG.WORD_CONFIDENCE_THRESHOLD) {
          appendRecognizedWord(wordMatch.word, now);
          detectedWord = wordMatch.word;
          handWasClassified = true;
        } else if (wordMatch.blockFingerspelling) {
          predictionHistory = [];
          resetCandidateState();
          detectedWord = wordMatch.poseLabel || 'SIGN';
          handWasClassified = true;
        }
      }

      // Check motion gestures first
      if (!handWasClassified && window.MotionTracker) {
        const motionMatch = window.MotionTracker.track(landmarks);
        if (motionMatch.letter && motionMatch.confidence >= CONFIG.CONFIDENCE_THRESHOLD) {
          rawLetter = motionMatch.letter;
          rawConfidence = motionMatch.confidence;
          handWasClassified = true;
        }
      }

      if (!handWasClassified) {
        const classification = classifyHandLandmarks(landmarks);
        if (classification.letter !== 'nothing') {
          rawLetter = classification.letter;
          rawConfidence = classification.confidence;
        }
      }

      const stableLetter = smoothPrediction(rawLetter, rawConfidence, true);
      if (stableLetter && stableLetter !== 'nothing' && stableLetter !== 'no_hand') {
        processLetter(stableLetter);
      }

      detectedLabel = detectedWord || stableLetter || rawLetter || 'weak';
      drawLandmarksOnCanvas(landmarks, detectedLabel);
    } else {
      const stableLetter = smoothPrediction(null, 0, false);
      if (stableLetter === 'no_hand') {
        processLetter('no_hand');
      }
      drawLandmarksOnCanvas(null, 'no_hand');
    }
  }

  function drawLandmarksOnCanvas(landmarks, detectedLetter) {
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
      if (detectedLetter === 'no_hand') {
        label.textContent = 'NO HAND';
      } else if (detectedLetter === 'weak') {
        label.textContent = '...';
      } else {
        label.textContent = (detectedLetter && detectedLetter !== 'nothing') ? detectedLetter : '-';
      }
    }

    if (!landmarks || landmarks.length === 0) return;

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
    ctx.restore();
  }

  function resetCandidateState() {
    currentCandidate = null;
    stableFrames = 0;
  }

  function resetRecognitionState() {
    resetCandidateState();
    lastConfirmedLetter = null;
    confirmationCooldownUntil = 0;
    awaitingRelease = false;
    currentWord = '';
    fullSentence = '';
    handMissingSince = null;
    lastLetterTime = Date.now();
    lastEmittedText = '';
    lastEmitWasPartial = null;
    awaitingFrameResult = false;
    lastFrameSentAt = 0;
    if (window.MotionTracker && typeof window.MotionTracker.reset === 'function') {
      window.MotionTracker.reset();
    }
    if (window.WordRecognition && typeof window.WordRecognition.reset === 'function') {
      window.WordRecognition.reset();
    }
  }

  function buildVisibleText() {
    if (fullSentence && currentWord) return `${fullSentence} ${currentWord}`;
    return fullSentence || currentWord || '';
  }

  function emitCaption(text, partial) {
    const normalizedText = text ? text.trim() : '';
    if (!normalizedText) return;
    if (normalizedText === lastEmittedText && partial === lastEmitWasPartial) return;
    lastEmittedText = normalizedText;
    lastEmitWasPartial = partial;

    if (onCaptionCallback) {
      onCaptionCallback(normalizedText, partial);
    }
  }

  function emitCurrentText(partial) {
    emitCaption(buildVisibleText(), partial);
  }

  function finalizeCurrentWord() {
    if (!currentWord) return false;

    fullSentence = fullSentence ? `${fullSentence} ${currentWord}` : currentWord;
    currentWord = '';
    emitCurrentText(false);
    return true;
  }

  function appendRecognizedWord(word, now = Date.now()) {
    if (!word) return;

    finalizeCurrentWord();
    fullSentence = fullSentence ? `${fullSentence} ${word}` : word;
    resetCandidateState();
    lastConfirmedLetter = null;
    confirmationCooldownUntil = 0;
    awaitingRelease = false;
    handMissingSince = null;
    lastLetterTime = now;
    emitCurrentText(false);
  }

  function deleteLastCharacter() {
    if (currentWord) {
      currentWord = currentWord.slice(0, -1);
      return true;
    }

    if (!fullSentence) return false;

    fullSentence = fullSentence.slice(0, -1).trimEnd();
    return true;
  }

  function releaseConfirmedPose(now) {
    if (now >= confirmationCooldownUntil) {
      awaitingRelease = false;
    }
  }

  function handleNoHand(now) {
    if (handMissingSince === null) {
      handMissingSince = now;
    }

    const missingDuration = now - handMissingSince;
    if (missingDuration < CONFIG.HAND_MISSING_GRACE_MS) {
      return;
    }

    resetCandidateState();

    if (missingDuration >= CONFIG.LETTER_RELEASE_MS) {
      awaitingRelease = false;
    }

    if (missingDuration >= CONFIG.SPACE_TIMEOUT_MS) {
      if (finalizeCurrentWord()) {
        lastLetterTime = now;
      }
    }
  }

  function handleSpecialLetter(letter, now) {
    if (letter === 'space') {
      resetCandidateState();
      awaitingRelease = false;
      if (finalizeCurrentWord()) {
        lastLetterTime = now;
      }
      return;
    }

    if (letter === 'del') {
      resetCandidateState();
      awaitingRelease = false;
      if (deleteLastCharacter()) {
        emitCurrentText(true);
      }
    }
  }

  function confirmCandidate(now) {
    if (!currentCandidate) return;

    if (
      currentCandidate === lastConfirmedLetter &&
      (awaitingRelease || now < confirmationCooldownUntil)
    ) {
      return;
    }

    currentWord += currentCandidate;
    lastConfirmedLetter = currentCandidate;
    confirmationCooldownUntil = now + CONFIG.CONFIRMATION_COOLDOWN_MS;
    awaitingRelease = true;
    lastLetterTime = now;
    emitCurrentText(true);
  }

  function processLetter(letter) {
    const now = Date.now();

    if (letter === 'no_hand') {
      handleNoHand(now);
      return;
    }

    handMissingSince = null;
    releaseConfirmedPose(now);

    if (now - lastLetterTime > CONFIG.SPACE_TIMEOUT_MS && currentWord) {
      finalizeCurrentWord();
    }

    if (letter === 'nothing' || letter === 'del' || letter === 'space') {
      handleSpecialLetter(letter, now);
      return;
    }

    if (awaitingRelease && letter === lastConfirmedLetter && now < confirmationCooldownUntil) {
      return;
    }

    if (letter === currentCandidate) {
      stableFrames++;
    } else {
      if (letter !== lastConfirmedLetter) {
        awaitingRelease = false;
      }
      currentCandidate = letter;
      stableFrames = 1;
    }

    if (stableFrames >= CONFIG.HOLD_FRAMES) {
      confirmCandidate(now);
      stableFrames = 0;
    }
  }

  async function startProcessingLoop() {
    if (!isActive || !videoElement) return;

    // Fingerspelling needs more detail than the previous half-size frames.
    const processCanvas = document.createElement('canvas');
    processCanvas.width = CONFIG.PROCESS_FRAME_WIDTH;
    processCanvas.height = Math.round((CONFIG.PROCESS_FRAME_WIDTH / CONFIG.CAMERA_WIDTH) * CONFIG.CAMERA_HEIGHT);
    const processCtx = processCanvas.getContext('2d');

    async function processFrame() {
      if (!isActive) return;

      const now = Date.now();
      const frameTimedOut = awaitingFrameResult && now - lastFrameSentAt >= CONFIG.FRAME_RESULT_TIMEOUT_MS;
      if (frameTimedOut) {
        awaitingFrameResult = false;
        logDebug('Frame result timeout, sending next frame');
      }

      if (videoElement.readyState >= 2) {
        if (awaitingFrameResult) {
          animFrameId = setTimeout(processFrame, CONFIG.PREDICTION_INTERVAL_MS);
          return;
        }

        processCtx.drawImage(videoElement, 0, 0, processCanvas.width, processCanvas.height);
        const dataUrl = processCanvas.toDataURL('image/webp', CONFIG.IMAGE_QUALITY);
        awaitingFrameResult = true;
        lastFrameSentAt = now;
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
    resetRecognitionState();
    predictionHistory = [];
    noHandFrameCount = 0;

    try {
      // Step 1: Initialize camera
      const cameraOk = await initializeCamera();
      if (!cameraOk) {
        throw new Error('Camera access denied');
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
      logDebug('ASL recognition started');

      return true;
    } catch (err) {
      console.error('[SignFlow ASL] Failed to start:', err);
      isActive = false;
      return false;
    }
  }

  function stop() {
    isActive = false;

    if (animFrameId) {
      clearTimeout(animFrameId);
      animFrameId = null;
    }

    if (videoElement && videoElement.srcObject) {
      videoElement.srcObject.getTracks().forEach((t) => t.stop());
      videoElement.srcObject = null;
      videoElement.remove();
      videoElement = null;
    }

    if (canvasElement) {
      canvasElement.remove();
      canvasElement = null;
    }
    canvasCtx = null;

    teardownHands();
    
    const container = document.getElementById('sf-pip-container');
    if (container) {
      container.style.display = 'none';
    }

    onCaptionCallback = null;
    resetRecognitionState();
    predictionHistory = [];
    noHandFrameCount = 0;
    logDebug('ASL recognition stopped and cleaned up');
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

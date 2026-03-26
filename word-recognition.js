// SignFlow Word Recognition
// Heuristic whole-sign recognizer for a small starter vocabulary.

const WordRecognition = (() => {
  const CONFIG = {
    HISTORY_SIZE: 36,
    MIN_FRAMES: 8,
    COOLDOWN_MS: 1800,
    STATIC_MOVEMENT_THRESHOLD: 0.3,
    MIN_VALID_RATIO: 0.75,
  };

  const history = [];
  let lastTriggerTime = 0;

  function dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
  }

  function average(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function getHandScale(landmarks) {
    const wrist = landmarks[0];
    const indexMCP = landmarks[5];
    const middleMCP = landmarks[9];
    const pinkyMCP = landmarks[17];
    const palmWidth = dist(indexMCP, pinkyMCP);
    const palmHeight = dist(wrist, middleMCP);

    return Math.max((palmWidth + palmHeight) / 2, 0.05);
  }

  function normalizePoint(point, wrist, scale) {
    return {
      x: (point.x - wrist.x) / scale,
      y: (point.y - wrist.y) / scale,
      z: (point.z - wrist.z) / scale,
    };
  }

  function isExtended(tip, pip, scale) {
    return (pip.y - tip.y) / scale > 0.2;
  }

  function isCurled(tip, mcp, scale) {
    return (tip.y - mcp.y) / scale > -0.04;
  }

  function countDirectionChanges(values, minDelta = 0.08) {
    let changes = 0;
    let lastDelta = 0;

    for (let i = 1; i < values.length; i++) {
      const delta = values[i] - values[i - 1];
      if (Math.abs(delta) < minDelta) continue;

      if (lastDelta !== 0 && Math.sign(delta) !== Math.sign(lastDelta)) {
        changes++;
      }
      lastDelta = delta;
    }

    return changes;
  }

  function getBounds(points) {
    let minX = points[0].x;
    let maxX = points[0].x;
    let minY = points[0].y;
    let maxY = points[0].y;

    for (const point of points) {
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }

    return {
      width: maxX - minX,
      height: maxY - minY,
    };
  }

  function pathLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += dist(points[i - 1], points[i]);
    }
    return total;
  }

  function extractFrameFeatures(landmarks) {
    const wrist = landmarks[0];
    const scale = getHandScale(landmarks);
    const thumbTip = landmarks[4];
    const thumbIP = landmarks[3];
    const indexTip = landmarks[8];
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

    const thumbExtended = Math.abs((thumbTip.x - thumbIP.x) / scale) > 0.24;
    const indexExtended = isExtended(indexTip, indexPIP, scale);
    const middleExtended = isExtended(middleTip, middlePIP, scale);
    const ringExtended = isExtended(ringTip, ringPIP, scale);
    const pinkyExtended = isExtended(pinkyTip, pinkyPIP, scale);
    const middleCurled = isCurled(middleTip, middleMCP, scale);
    const ringCurled = isCurled(ringTip, ringMCP, scale);
    const thumbToIndexBase = dist(thumbTip, indexMCP) / scale;
    const thumbToMiddleBase = dist(thumbTip, middleMCP) / scale;
    const thumbToPinkyBase = dist(thumbTip, pinkyMCP) / scale;
    const thumbOut = thumbExtended && thumbToIndexBase > 0.9 && thumbToMiddleBase > 0.95 && thumbToPinkyBase > 0.9;
    const indexPinkySpread = dist(indexTip, pinkyTip) / scale;

    const openPalm = indexExtended && middleExtended && ringExtended && pinkyExtended;
    const fist = !indexExtended && !middleExtended && !ringExtended && !pinkyExtended;
    const ily = thumbOut && indexExtended && pinkyExtended && middleCurled && ringCurled;

    return {
      wrist: normalizePoint(wrist, wrist, scale),
      indexTip: normalizePoint(indexTip, wrist, scale),
      pinkyTip: normalizePoint(pinkyTip, wrist, scale),
      palmCenter: {
        x: (average([landmarks[0].x, landmarks[5].x, landmarks[9].x, landmarks[17].x]) - wrist.x) / scale,
        y: (average([landmarks[0].y, landmarks[5].y, landmarks[9].y, landmarks[17].y]) - wrist.y) / scale,
        z: (average([landmarks[0].z, landmarks[5].z, landmarks[9].z, landmarks[17].z]) - wrist.z) / scale,
      },
      openPalm,
      fist,
      ily,
      thumbOut,
      indexPinkySpread,
      scale,
    };
  }

  function getRecentHistory() {
    return history.slice(-Math.min(history.length, CONFIG.HISTORY_SIZE));
  }

  function detectHello(entries) {
    const openRatio = entries.filter((entry) => entry.openPalm).length / entries.length;
    if (openRatio < CONFIG.MIN_VALID_RATIO) return { word: null, confidence: 0 };

    const palmPoints = entries.map((entry) => entry.palmCenter);
    const bounds = getBounds(palmPoints);
    const xValues = palmPoints.map((point) => point.x);
    const yValues = palmPoints.map((point) => point.y);
    const xDirectionChanges = countDirectionChanges(xValues, 0.12);
    const yDirectionChanges = countDirectionChanges(yValues, 0.08);

    if (bounds.width < 0.8 || bounds.height > 0.7) return { word: null, confidence: 0 };
    if (xDirectionChanges < 2 || xDirectionChanges > 5) return { word: null, confidence: 0 };
    if (yDirectionChanges > 2) return { word: null, confidence: 0 };

    return { word: 'HELLO', confidence: 0.84 };
  }

  function detectYes(entries) {
    const fistRatio = entries.filter((entry) => entry.fist).length / entries.length;
    if (fistRatio < CONFIG.MIN_VALID_RATIO) return { word: null, confidence: 0 };

    const palmPoints = entries.map((entry) => entry.palmCenter);
    const bounds = getBounds(palmPoints);
    const yValues = palmPoints.map((point) => point.y);
    const xValues = palmPoints.map((point) => point.x);
    const yDirectionChanges = countDirectionChanges(yValues, 0.1);
    const xDirectionChanges = countDirectionChanges(xValues, 0.08);

    if (bounds.height < 0.45 || bounds.width > 0.65) return { word: null, confidence: 0 };
    if (yDirectionChanges < 1 || yDirectionChanges > 3) return { word: null, confidence: 0 };
    if (xDirectionChanges > 2) return { word: null, confidence: 0 };

    return { word: 'YES', confidence: 0.83 };
  }

  function detectStop(entries) {
    const openRatio = entries.filter((entry) => entry.openPalm).length / entries.length;
    if (openRatio < 0.85) return { word: null, confidence: 0 };

    const palmPoints = entries.map((entry) => entry.palmCenter);
    const movement = pathLength(palmPoints);
    if (movement > CONFIG.STATIC_MOVEMENT_THRESHOLD) return { word: null, confidence: 0 };

    return { word: 'STOP', confidence: 0.8 };
  }

  function detectILY(entries) {
    const ilyRatio = entries.filter((entry) => entry.ily).length / entries.length;
    const thumbOutRatio = entries.filter((entry) => entry.thumbOut).length / entries.length;
    if (ilyRatio < 0.7 || thumbOutRatio < 0.75) return { word: null, confidence: 0 };

    const palmPoints = entries.map((entry) => entry.palmCenter);
    const movement = pathLength(palmPoints);
    const spreadAverage = average(entries.map((entry) => entry.indexPinkySpread));

    if (movement > CONFIG.STATIC_MOVEMENT_THRESHOLD) return { word: null, confidence: 0 };
    if (spreadAverage < 1.35) return { word: null, confidence: 0 };

    return { word: 'I LOVE YOU', confidence: 0.88 };
  }

  function track(landmarks) {
    if (!landmarks || landmarks.length < 21) return { word: null, confidence: 0 };

    const now = Date.now();
    if (now - lastTriggerTime < CONFIG.COOLDOWN_MS) return { word: null, confidence: 0 };

    history.push({
      t: now,
      ...extractFrameFeatures(landmarks),
    });

    if (history.length > CONFIG.HISTORY_SIZE) {
      history.shift();
    }

    const recentHistory = getRecentHistory();
    if (recentHistory.length < CONFIG.MIN_FRAMES) return { word: null, confidence: 0 };

    const candidates = [
      detectHello(recentHistory),
      detectYes(recentHistory),
      detectStop(recentHistory),
      detectILY(recentHistory),
    ].filter((match) => match.word);

    if (!candidates.length) return { word: null, confidence: 0 };

    candidates.sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0];
    lastTriggerTime = now;
    history.length = 0;

    return best;
  }

  function reset() {
    history.length = 0;
    lastTriggerTime = 0;
  }

  return { track, reset };
})();

if (typeof window !== 'undefined') {
  window.WordRecognition = WordRecognition;
}

// SignFlow Motion Tracker
// Tracks fingertip trajectories to detect dynamic ASL letters like J and Z

const MotionTracker = (() => {
  const HISTORY_SIZE = 30;
  const MIN_PATTERN_POINTS = 10;
  const COOLDOWN_MS = 1200;
  const MIN_VALID_RATIO = 0.7;
  const history = []; // stores normalized fingertip trajectories for dynamic letters only
  let lastTriggerTime = 0;

  function dist(a, b) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
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

  function isIndexPosePlausible(landmarks, scale) {
    const indexTip = landmarks[8];
    const indexPIP = landmarks[6];
    const middleTip = landmarks[12];
    const middleMCP = landmarks[9];
    const ringTip = landmarks[16];
    const ringMCP = landmarks[13];
    const pinkyTip = landmarks[20];
    const pinkyMCP = landmarks[17];

    return (
      isExtended(indexTip, indexPIP, scale) &&
      isCurled(middleTip, middleMCP, scale) &&
      isCurled(ringTip, ringMCP, scale) &&
      isCurled(pinkyTip, pinkyMCP, scale)
    );
  }

  function isPinkyPosePlausible(landmarks, scale) {
    const pinkyTip = landmarks[20];
    const pinkyPIP = landmarks[18];
    const indexTip = landmarks[8];
    const indexMCP = landmarks[5];
    const middleTip = landmarks[12];
    const middleMCP = landmarks[9];
    const ringTip = landmarks[16];
    const ringMCP = landmarks[13];

    return (
      isExtended(pinkyTip, pinkyPIP, scale) &&
      isCurled(indexTip, indexMCP, scale) &&
      isCurled(middleTip, middleMCP, scale) &&
      isCurled(ringTip, ringMCP, scale)
    );
  }

  function pathLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      total += dist(points[i - 1], points[i]);
    }
    return total;
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
      minX,
      maxX,
      minY,
      maxY,
    };
  }

  function countDirectionChanges(points, axis) {
    let changes = 0;
    let lastDelta = 0;

    for (let i = 1; i < points.length; i++) {
      const delta = points[i][axis] - points[i - 1][axis];
      if (Math.abs(delta) < 0.08) continue;

      if (lastDelta !== 0 && Math.sign(delta) !== Math.sign(lastDelta)) {
        changes++;
      }
      lastDelta = delta;
    }

    return changes;
  }

  function getRecentValidPoints(points, key) {
    const filtered = points.filter((entry) => entry[key]).map((entry) => entry[key]);
    return filtered.slice(-Math.min(filtered.length, HISTORY_SIZE));
  }

  function track(landmarks) {
    if (!landmarks || landmarks.length < 21) return { letter: null, confidence: 0 };

    const now = Date.now();
    if (now - lastTriggerTime < COOLDOWN_MS) return { letter: null, confidence: 0 };
    const wrist = landmarks[0];
    const scale = getHandScale(landmarks);
    const indexPoseValid = isIndexPosePlausible(landmarks, scale);
    const pinkyPoseValid = isPinkyPosePlausible(landmarks, scale);

    history.push({
      t: now,
      indexPoint: indexPoseValid ? normalizePoint(landmarks[8], wrist, scale) : null,
      pinkyPoint: pinkyPoseValid ? normalizePoint(landmarks[20], wrist, scale) : null,
      indexPoseValid,
      pinkyPoseValid,
    });

    if (history.length > HISTORY_SIZE) {
      history.shift();
    }

    const recentHistory = history.slice(-MIN_PATTERN_POINTS);
    const validIndexRatio = recentHistory.filter((entry) => entry.indexPoseValid).length / recentHistory.length;
    const validPinkyRatio = recentHistory.filter((entry) => entry.pinkyPoseValid).length / recentHistory.length;

    // Detect Z only when the handshape plausibly matches an index-led dynamic letter.
    const zMatch = detectZPattern(getRecentValidPoints(history, 'indexPoint'), validIndexRatio);
    if (zMatch.confidence > 0.75) {
      lastTriggerTime = now;
      history.length = 0;
      return { letter: 'Z', confidence: zMatch.confidence };
    }

    // Detect J only when the handshape plausibly matches a pinky-led dynamic letter.
    const jMatch = detectJPattern(getRecentValidPoints(history, 'pinkyPoint'), validPinkyRatio);
    if (jMatch.confidence > 0.75) {
      lastTriggerTime = now;
      history.length = 0;
      return { letter: 'J', confidence: jMatch.confidence };
    }

    return { letter: null, confidence: 0 };
  }

  function detectZPattern(points, validRatio) {
    if (validRatio < MIN_VALID_RATIO || points.length < MIN_PATTERN_POINTS) {
      return { confidence: 0 };
    }

    const bounds = getBounds(points);
    const width = bounds.width;
    const height = bounds.height;
    const horizontalChanges = countDirectionChanges(points, 'x');
    const verticalChanges = countDirectionChanges(points, 'y');
    const travel = pathLength(points);

    if (width < 0.9 || height < 0.35) {
      return { confidence: 0 };
    }

    if (travel < 1.5 || travel > 6) {
      return { confidence: 0 };
    }

    if (horizontalChanges < 2 || horizontalChanges > 4) {
      return { confidence: 0 };
    }

    if (verticalChanges > 4) {
      return { confidence: 0 };
    }

    const start = points[0];
    const end = points[points.length - 1];
    const netX = Math.abs(end.x - start.x);
    if (netX < 0.6) {
      return { confidence: 0 };
    }

    return { confidence: 0.86 };
  }

  function detectJPattern(points, validRatio) {
    if (validRatio < MIN_VALID_RATIO || points.length < MIN_PATTERN_POINTS) {
      return { confidence: 0 };
    }

    const bounds = getBounds(points);
    const width = bounds.width;
    const height = bounds.height;
    const travel = pathLength(points);
    const horizontalChanges = countDirectionChanges(points, 'x');

    if (height < 0.7 || width < 0.2) {
      return { confidence: 0 };
    }

    if (travel < 1.1 || travel > 5) {
      return { confidence: 0 };
    }

    if (horizontalChanges > 3) {
      return { confidence: 0 };
    }

    let lowestIdx = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].y > points[lowestIdx].y) {
        lowestIdx = i;
      }
    }

    if (lowestIdx < 3 || lowestIdx > points.length - 4) {
      return { confidence: 0 };
    }

    const start = points[0];
    const lowest = points[lowestIdx];
    const end = points[points.length - 1];
    const drop = lowest.y - start.y;
    const rise = lowest.y - end.y;
    const hook = Math.abs(end.x - lowest.x);

    if (drop < 0.45 || rise < 0.3 || hook < 0.18) {
      return { confidence: 0 };
    }

    return { confidence: 0.84 };
  }

  function reset() {
    history.length = 0;
    lastTriggerTime = 0;
  }

  return { track, reset };
})();

if (typeof window !== 'undefined') {
  window.MotionTracker = MotionTracker;
}

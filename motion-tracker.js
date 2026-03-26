// SignFlow Motion Tracker
// Tracks fingertip trajectories to detect dynamic ASL letters like J and Z

const MotionTracker = (() => {
  const HISTORY_SIZE = 25;
  const history = []; // stores { t, indexTip, pinkyTip }
  let lastTriggerTime = 0;
  const COOLDOWN_MS = 800;

  function track(landmarks) {
    if (!landmarks || landmarks.length < 21) return { letter: null, confidence: 0 };
    
    const now = Date.now();
    if (now - lastTriggerTime < COOLDOWN_MS) return { letter: null, confidence: 0 };

    history.push({
      t: now,
      indexTip: landmarks[8],
      pinkyTip: landmarks[20]
    });

    if (history.length > HISTORY_SIZE) {
      history.shift();
    }

    if (history.length < 10) return { letter: null, confidence: 0 };

    // Detect Z using index tip
    const zMatch = detectZPattern(history.map(h => h.indexTip));
    if (zMatch.confidence > 0.75) {
      lastTriggerTime = now;
      history.length = 0;
      return { letter: 'Z', confidence: zMatch.confidence };
    }

    // Detect J using pinky tip
    const jMatch = detectJPattern(history.map(h => h.pinkyTip));
    if (jMatch.confidence > 0.75) {
      lastTriggerTime = now;
      history.length = 0;
      return { letter: 'J', confidence: jMatch.confidence };
    }

    return { letter: null, confidence: 0 };
  }

  function detectZPattern(pts) {
    const start = pts[0];
    const end = pts[pts.length - 1];
    
    let leftMost = start.x, rightMost = start.x;
    for (const p of pts) {
      if (p.x < leftMost) leftMost = p.x;
      if (p.x > rightMost) rightMost = p.x;
    }
    const width = rightMost - leftMost;
    const height = Math.abs(end.y - start.y);

    let directionChanges = 0;
    let lastDx = 0;
    for (let i = 2; i < pts.length; i++) {
        const dx = pts[i].x - pts[i-1].x;
        // Looking for significant x-direction changes
        if (Math.abs(dx) > 0.015) {
            if (Math.sign(dx) !== Math.sign(lastDx) && lastDx !== 0) {
                directionChanges++;
            }
            lastDx = dx;
        }
    }

    // A Z-pattern usually has 2 sharp direction changes in the X axis
    if (directionChanges >= 2 && width > 0.1 && height > 0.05) {
        return { confidence: 0.85 };
    }
    return { confidence: 0 };
  }

  function detectJPattern(pts) {
    const start = pts[0];
    
    // Find the lowest point (highest y value in screen coords)
    let lowestY = start.y;
    let lowestIdx = 0;
    for (let i = 0; i < pts.length; i++) {
        if (pts[i].y > lowestY) {
            lowestY = pts[i].y;
            lowestIdx = i;
        }
    }
    
    // J pattern: goes down to a lowest point, then curves up and left (or right if mirrored)
    if (lowestIdx > 5 && lowestIdx < pts.length - 3) {
        const afterLowest = pts[pts.length - 1];
        const dy = lowestY - afterLowest.y;
        const dx = Math.abs(pts[lowestIdx].x - afterLowest.x);
        
        // It must curve upwards at the end, and have some horizontal displacement
        if (dy > 0.03 && dx > 0.02) {
            return { confidence: 0.82 };
        }
    }
    return { confidence: 0 };
  }

  return { track };
})();

if (typeof window !== 'undefined') {
  window.MotionTracker = MotionTracker;
}

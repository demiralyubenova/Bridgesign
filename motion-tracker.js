// BridgeSign Motion Tracker
// Tracks hand trajectories to detect dynamic ASL letters and starter word patterns.

const MotionTracker = (() => {
  const HISTORY_SIZE = 30;
  const singleHandHistory = []; // stores { t, indexTip, pinkyTip, center, pose }
  const dualHandHistory = []; // stores { t, leftCenter, rightCenter, leftPose, rightPose }
  let lastTriggerTime = 0;
  const COOLDOWN_MS = 1200;

  function track(input) {
    const hands = normalizeHands(input);
    if (hands.length === 0) return { token: null, kind: null, confidence: 0 };
    
    const now = Date.now();
    if (now - lastTriggerTime < COOLDOWN_MS) return { token: null, kind: null, confidence: 0 };

    if (hands.length >= 2) {
      const dualMatch = trackTwoHands(hands, now);
      if (dualMatch.token) {
        return dualMatch;
      }
    } else {
      dualHandHistory.length = 0;
    }

    return trackSingleHand(hands[0], now);
  }

  function normalizeHands(input) {
    if (!Array.isArray(input) || input.length === 0) return [];
    if (Array.isArray(input[0])) {
      return input.filter((hand) => Array.isArray(hand) && hand.length >= 21);
    }
    return input.length >= 21 ? [input] : [];
  }

  function trackSingleHand(landmarks, now) {
    const pose = summarizePose(landmarks);

    singleHandHistory.push({
      t: now,
      indexTip: landmarks[8],
      pinkyTip: landmarks[20],
      center: pose.center,
      pose: pose.name,
    });

    if (singleHandHistory.length > HISTORY_SIZE) {
      singleHandHistory.shift();
    }

    if (singleHandHistory.length < 10) return { token: null, kind: null, confidence: 0 };

    const helloMatch = detectHelloPattern(singleHandHistory);
    if (helloMatch.confidence > 0.8) {
      lastTriggerTime = now;
      resetHistories();
      return { token: 'HELLO', kind: 'word', confidence: helloMatch.confidence };
    }

    const yesMatch = detectYesPattern(singleHandHistory);
    if (yesMatch.confidence > 0.8) {
      lastTriggerTime = now;
      resetHistories();
      return { token: 'YES', kind: 'word', confidence: yesMatch.confidence };
    }

    // Detect Z using index tip
    const zMatch = detectZPattern(singleHandHistory.map(h => h.indexTip));
    if (zMatch.confidence > 0.75) {
      lastTriggerTime = now;
      resetHistories();
      return { token: 'Z', kind: 'letter', confidence: zMatch.confidence };
    }

    // Detect J using pinky tip
    const jMatch = detectJPattern(singleHandHistory.map(h => h.pinkyTip));
    if (jMatch.confidence > 0.75) {
      lastTriggerTime = now;
      resetHistories();
      return { token: 'J', kind: 'letter', confidence: jMatch.confidence };
    }

    return { token: null, kind: null, confidence: 0 };
  }

  function trackTwoHands(hands, now) {
    const summarized = hands
      .map((hand) => summarizePose(hand))
      .sort((a, b) => a.center.x - b.center.x);

    dualHandHistory.push({
      t: now,
      leftCenter: summarized[0].center,
      rightCenter: summarized[1].center,
      leftPose: summarized[0].name,
      rightPose: summarized[1].name,
    });

    if (dualHandHistory.length > HISTORY_SIZE) {
      dualHandHistory.shift();
    }

    if (dualHandHistory.length < 10) return { token: null, kind: null, confidence: 0 };

    const bookMatch = detectBookPattern(dualHandHistory);
    if (bookMatch.confidence > 0.8) {
      lastTriggerTime = now;
      resetHistories();
      return { token: 'BOOK', kind: 'word', confidence: bookMatch.confidence };
    }

    return { token: null, kind: null, confidence: 0 };
  }

  function resetHistories() {
    singleHandHistory.length = 0;
    dualHandHistory.length = 0;
  }

  function summarizePose(landmarks) {
    const thumbTip = landmarks[4];
    const thumbIP = landmarks[3];
    const indexTip = landmarks[8];
    const indexPIP = landmarks[6];
    const middleTip = landmarks[12];
    const middlePIP = landmarks[10];
    const ringTip = landmarks[16];
    const ringPIP = landmarks[14];
    const pinkyTip = landmarks[20];
    const pinkyPIP = landmarks[18];
    const wrist = landmarks[0];
    const indexMCP = landmarks[5];
    const middleMCP = landmarks[9];
    const ringMCP = landmarks[13];
    const pinkyMCP = landmarks[17];

    function isExtended(tip, pip) { return tip.y < pip.y - 0.02; }

    const indexExtended = isExtended(indexTip, indexPIP);
    const middleExtended = isExtended(middleTip, middlePIP);
    const ringExtended = isExtended(ringTip, ringPIP);
    const pinkyExtended = isExtended(pinkyTip, pinkyPIP);
    const thumbExtended = Math.abs(thumbTip.x - thumbIP.x) > 0.04;

    let name = 'other';
    if (indexExtended && middleExtended && ringExtended && pinkyExtended && thumbExtended) {
      name = 'open-palm';
    } else if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
      name = 'fist';
    } else if (!indexExtended && !middleExtended && !ringExtended && pinkyExtended) {
      name = 'pinky';
    } else if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
      name = 'point';
    }

    return {
      name,
      center: {
        x: (wrist.x + indexMCP.x + middleMCP.x + ringMCP.x + pinkyMCP.x) / 5,
        y: (wrist.y + indexMCP.y + middleMCP.y + ringMCP.y + pinkyMCP.y) / 5,
      },
    };
  }

  function dominantPose(entries) {
    const counts = new Map();
    for (const entry of entries) {
      counts.set(entry.pose, (counts.get(entry.pose) || 0) + 1);
    }

    let bestPose = null;
    let bestCount = 0;
    for (const [pose, count] of counts.entries()) {
      if (count > bestCount) {
        bestPose = pose;
        bestCount = count;
      }
    }

    return { pose: bestPose, count: bestCount };
  }

  function countDirectionChanges(values, threshold) {
    let changes = 0;
    let lastDelta = 0;

    for (let i = 1; i < values.length; i++) {
      const delta = values[i] - values[i - 1];
      if (Math.abs(delta) <= threshold) continue;
      if (lastDelta !== 0 && Math.sign(delta) !== Math.sign(lastDelta)) {
        changes++;
      }
      lastDelta = delta;
    }

    return changes;
  }

  function detectHelloPattern(entries) {
    const { pose, count } = dominantPose(entries);
    if (pose !== 'open-palm' || count < Math.floor(entries.length * 0.65)) {
      return { confidence: 0 };
    }

    const xs = entries.map((entry) => entry.center.x);
    const ys = entries.map((entry) => entry.center.y);
    const xAmplitude = Math.max(...xs) - Math.min(...xs);
    const yAmplitude = Math.max(...ys) - Math.min(...ys);
    const xChanges = countDirectionChanges(xs, 0.01);

    if (xAmplitude > 0.12 && yAmplitude < 0.1 && xChanges >= 2) {
      return { confidence: 0.88 };
    }

    return { confidence: 0 };
  }

  function detectYesPattern(entries) {
    const { pose, count } = dominantPose(entries);
    if (pose !== 'fist' || count < Math.floor(entries.length * 0.65)) {
      return { confidence: 0 };
    }

    const xs = entries.map((entry) => entry.center.x);
    const ys = entries.map((entry) => entry.center.y);
    const xAmplitude = Math.max(...xs) - Math.min(...xs);
    const yAmplitude = Math.max(...ys) - Math.min(...ys);
    const yChanges = countDirectionChanges(ys, 0.008);

    if (yAmplitude > 0.09 && xAmplitude < 0.08 && yChanges >= 1) {
      return { confidence: 0.86 };
    }

    return { confidence: 0 };
  }

  function detectBookPattern(entries) {
    const openFrames = entries.filter(
      (entry) => entry.leftPose === 'open-palm' && entry.rightPose === 'open-palm'
    ).length;

    if (openFrames < Math.floor(entries.length * 0.65)) {
      return { confidence: 0 };
    }

    const first = averageDualEntry(entries.slice(0, 4));
    const last = averageDualEntry(entries.slice(-4));

    const startGap = first.rightCenter.x - first.leftCenter.x;
    const endGap = last.rightCenter.x - last.leftCenter.x;
    const leftMove = first.leftCenter.x - last.leftCenter.x;
    const rightMove = last.rightCenter.x - first.rightCenter.x;
    const verticalShift = Math.max(
      Math.abs(first.leftCenter.y - last.leftCenter.y),
      Math.abs(first.rightCenter.y - last.rightCenter.y)
    );

    if (
      startGap < 0.2
      && endGap > startGap + 0.12
      && leftMove > 0.04
      && rightMove > 0.04
      && verticalShift < 0.08
    ) {
      return { confidence: 0.87 };
    }

    return { confidence: 0 };
  }

  function averageDualEntry(entries) {
    const count = Math.max(entries.length, 1);
    const sum = entries.reduce((acc, entry) => {
      acc.leftCenter.x += entry.leftCenter.x;
      acc.leftCenter.y += entry.leftCenter.y;
      acc.rightCenter.x += entry.rightCenter.x;
      acc.rightCenter.y += entry.rightCenter.y;
      return acc;
    }, {
      leftCenter: { x: 0, y: 0 },
      rightCenter: { x: 0, y: 0 },
    });

    return {
      leftCenter: {
        x: sum.leftCenter.x / count,
        y: sum.leftCenter.y / count,
      },
      rightCenter: {
        x: sum.rightCenter.x / count,
        y: sum.rightCenter.y / count,
      },
    };
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

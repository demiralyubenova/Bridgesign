// SignFlow Meet Caption Scraper
// Watches Google Meet for built-in captions so the signer flow can
// translate speech without depending on microphone pickup.

const MeetCaptionScraper = (() => {
  'use strict';

  let isActive = false;
  let pageObserver = null;
  let pollIntervalId = null;
  let processTimer = null;
  let captionCallback = null;
  let captionContainer = null;
  let lastSpeaker = '';
  let captionsSeenAt = 0;
  const recentlyEmitted = new Map();

  const CAPTION_CONTAINER_SELECTORS = [
    'div.a4cQT',
    'div[jscontroller] div.iOzk7',
    'div.TBMuR.bj4p3b',
    'div[aria-live="polite"]',
    'div[aria-live="assertive"]',
    'div[role="log"]',
    'div[role="status"]',
    'div[class*="caption"]',
    'div[class*="subtitle"]',
    'div[data-is-caption]',
  ];

  const SPEAKER_SELECTORS = [
    'div.zs7s8d.jxFHg',
    'span.CNusmb',
    'span[data-self-name]',
    'div[class*="speaker"]',
    'span[class*="speaker"]',
  ];

  const TEXT_SELECTORS = [
    'span.VbkSUe',
    'div.iTTPOb.VbkSUe span',
    'span[class*="caption"]',
    'span[class*="subtitle"]',
    'div[class*="caption"] span',
    'div[class*="subtitle"] span',
  ];

  const SYSTEM_ANNOUNCEMENT_PATTERNS = [
    /\b(you|someone) joined\b/,
    /\b(you|someone) left\b/,
    /\braised (their )?hand\b/,
    /\bmeeting recording\b/,
    /\bpresenting\b/,
    /\bcaption(s)? turned (on|off)\b/,
    /\bsubtitle(s)? turned (on|off)\b/,
    /участва в обаждането/i,
    /напусна обаждането/i,
    /се присъедини/i,
  ];

  const BRIDGESIGN_UI_SELECTORS = [
    '#bridgesign-root',
    '#sf-pip-container',
    '#sf-sign-spotlight',
    '#bridgesign-role-selector',
    '#bridgesign-onboarding',
    '#sf-toast-container',
  ];

  const GENERIC_NON_CAPTION_LABELS = new Set([
    'speaker',
    'speakers',
    'signer',
    'signers',
    'voice',
    'toolbar',
    'transcript',
    'listening',
    'asl',
    'playback',
    'preview',
    'replay',
    'you',
  ]);

  function normalizeText(value) {
    return (value || '').replace(/\s+/g, ' ').trim();
  }

  function isBridgeSignUiElement(el) {
    if (!el || typeof el.closest !== 'function') return false;
    return BRIDGESIGN_UI_SELECTORS.some((selector) => Boolean(el.closest(selector)));
  }

  function containsBridgeSignUi(el) {
    if (!el || typeof el.querySelector !== 'function') return false;
    return BRIDGESIGN_UI_SELECTORS.some((selector) => Boolean(el.querySelector(selector)));
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
  }

  function isSystemAnnouncement(text) {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) return false;
    return SYSTEM_ANNOUNCEMENT_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  function looksLikeInvalidCaptionText(speaker, text) {
    const normalizedSpeaker = normalizeText(speaker).toLowerCase();
    const normalizedText = normalizeText(text).toLowerCase();
    if (!normalizedText) return true;

    if (
      normalizedText.includes('listening') ||
      normalizedText.includes('toolbar') ||
      normalizedText.includes('transcript') ||
      normalizedText.includes('asl playback') ||
      normalizedText.includes('asl preview')
    ) {
      return true;
    }

    const words = normalizedText
      .split(/\s+/)
      .map((word) => word.replace(/[^a-z0-9'-]/g, ''))
      .filter(Boolean);
    if (!words.length) return true;

    if (normalizedSpeaker && normalizedText === normalizedSpeaker) {
      return true;
    }

    if (words.length === 1 && GENERIC_NON_CAPTION_LABELS.has(words[0])) {
      return true;
    }

    if (words.length >= 2) {
      const uniqueWords = new Set(words);
      if (uniqueWords.size === 1) {
        const repeatedWord = words[0];
        if (repeatedWord === normalizedSpeaker || GENERIC_NON_CAPTION_LABELS.has(repeatedWord)) {
          return true;
        }
      }
    }

    return false;
  }

  function scoreContainer(el) {
    if (!el) return -Infinity;
    const rect = el.getBoundingClientRect();
    const text = normalizeText(el.innerText || el.textContent || '');
    const className = (el.className || '').toString().toLowerCase();
    const areaRatio = (rect.width * rect.height) / Math.max(window.innerWidth * window.innerHeight, 1);
    let score = 0;

    if (containsBridgeSignUi(el)) return -Infinity;
    if (areaRatio > 0.45) return -Infinity;

    if (el.matches('div.a4cQT, div.TBMuR.bj4p3b')) score += 60;
    if (el.matches('div[aria-live="polite"], div[aria-live="assertive"]')) score += 35;
    if (el.matches('div[role="log"], div[role="status"]')) score += 25;
    if (className.includes('caption') || className.includes('subtitle')) score += 20;
    if (rect.bottom > window.innerHeight * 0.55) score += 15;
    if (rect.height >= 18 && rect.height <= 220) score += 10;
    if (text.length >= 2 && text.length <= 220) score += 10;
    return score;
  }

  function closestCaptionBubble(el) {
    let node = el;
    for (let depth = 0; node && depth < 6; depth += 1) {
      if (node.nodeType === Node.ELEMENT_NODE && isVisible(node)) {
        const score = scoreContainer(node);
        if (score > 15) {
          return node;
        }
      }
      node = node.parentElement;
    }
    return el && el.parentElement ? el.parentElement : el;
  }

  function findCaptionContainers() {
    const candidates = new Set();

    for (const selector of CAPTION_CONTAINER_SELECTORS) {
      document.querySelectorAll(selector).forEach((el) => {
        if (isVisible(el) && !isBridgeSignUiElement(el) && !containsBridgeSignUi(el)) candidates.add(el);
      });
    }

    document.querySelectorAll(SPEAKER_SELECTORS.join(',')).forEach((speakerEl) => {
      if (!isVisible(speakerEl) || isBridgeSignUiElement(speakerEl)) return;
      const bubble = closestCaptionBubble(speakerEl);
      if (bubble && isVisible(bubble) && !isBridgeSignUiElement(bubble) && !containsBridgeSignUi(bubble)) {
        candidates.add(bubble);
      }
    });

    const sorted = Array.from(candidates)
      .filter((el) => normalizeText(el.innerText || el.textContent || '').length > 0)
      .sort((a, b) => {
        const scoreDelta = scoreContainer(b) - scoreContainer(a);
        if (scoreDelta !== 0) return scoreDelta;
        const areaA = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
        const areaB = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
        return areaA - areaB;
      });

    const filtered = [];
    for (const candidate of sorted) {
      const text = normalizeText(candidate.innerText || candidate.textContent || '');
      const duplicateAncestor = filtered.some((kept) =>
        kept.contains(candidate) && normalizeText(kept.innerText || kept.textContent || '') === text
      );
      const duplicateDescendant = filtered.some((kept) =>
        candidate.contains(kept) && normalizeText(kept.innerText || kept.textContent || '') === text
      );
      if (!duplicateAncestor && !duplicateDescendant) {
        filtered.push(candidate);
      }
    }

    captionContainer = filtered[0] || null;
    return filtered.slice(0, 6);
  }

  function extractStructuredCaptions(container) {
    if (containsBridgeSignUi(container)) return [];

    const results = [];
    const seen = new Set();

    for (const selector of SPEAKER_SELECTORS) {
      const speakerEls = container.querySelectorAll(selector);
      for (const speakerEl of speakerEls) {
        if (!isVisible(speakerEl) || isBridgeSignUiElement(speakerEl)) continue;
        const speaker = normalizeText(speakerEl.textContent);
        if (!speaker || speaker.length > 40) continue;

        const bubble = closestCaptionBubble(speakerEl);
        if (bubble && isBridgeSignUiElement(bubble)) continue;
        let text = '';

        for (const textSelector of TEXT_SELECTORS) {
          const textEls = bubble ? bubble.querySelectorAll(textSelector) : [];
          const pieces = Array.from(textEls)
            .filter((el) => isVisible(el))
            .map((el) => normalizeText(el.textContent))
            .filter((value) => value && value !== speaker);

          if (pieces.length) {
            text = pieces.join(' ');
            break;
          }
        }

        if (!text && bubble) {
          const lines = (bubble.innerText || '')
            .split('\n')
            .map((line) => normalizeText(line))
            .filter(Boolean);
          if (lines.length >= 2) {
            const withoutSpeaker = lines.filter((line) => line !== speaker);
            text = withoutSpeaker.join(' ');
          }
        }

        const normalizedText = normalizeText(text);
        const key = `${speaker}::${normalizedText}`;
        if (!normalizedText || isSystemAnnouncement(normalizedText) || looksLikeInvalidCaptionText(speaker, normalizedText) || seen.has(key)) continue;

        seen.add(key);
        results.push({ speaker, text: normalizedText });
      }
    }

    return results;
  }

  function extractFallbackCaptions(container) {
    if (isBridgeSignUiElement(container) || containsBridgeSignUi(container)) return [];

    const text = normalizeText(container.innerText || container.textContent || '');
    if (!text || isSystemAnnouncement(text)) return [];

    const lines = text
      .split('\n')
      .map((line) => normalizeText(line))
      .filter(Boolean);

    if (!lines.length) return [];

    if (lines.length >= 2 && lines[0].length <= 40) {
      const speaker = lines[0];
      const content = normalizeText(lines.slice(1).join(' '));
      if (!content || isSystemAnnouncement(content) || looksLikeInvalidCaptionText(speaker, content)) return [];
      return [{ speaker, text: content }];
    }

    const fallbackSpeaker = lastSpeaker || 'Speaker';
    const fallbackText = lines.join(' ');
    if (looksLikeInvalidCaptionText(fallbackSpeaker, fallbackText)) return [];
    return [{ speaker: fallbackSpeaker, text: fallbackText }];
  }

  function collectCaptions() {
    const containers = findCaptionContainers();
    const results = [];
    const seen = new Set();

    for (const container of containers) {
      const extracted = extractStructuredCaptions(container);
      const captions = extracted.length ? extracted : extractFallbackCaptions(container);

      for (const caption of captions) {
        const speaker = normalizeText(caption.speaker || lastSpeaker || 'Speaker');
        const text = normalizeText(caption.text);
        const key = `${speaker.toLowerCase()}::${text.toLowerCase()}`;
        if (!text || isSystemAnnouncement(text) || looksLikeInvalidCaptionText(speaker, text) || seen.has(key)) continue;
        seen.add(key);
        results.push({ speaker, text });
      }
    }

    return results;
  }

  function emitCaptions(captions) {
    if (!captionCallback || !captions.length) return;

    const now = Date.now();
    for (const [key, ts] of recentlyEmitted.entries()) {
      if (now - ts > 2500) {
        recentlyEmitted.delete(key);
      }
    }

    for (const caption of captions) {
      const key = `${caption.speaker.toLowerCase()}::${caption.text.toLowerCase()}`;
      if (recentlyEmitted.has(key)) continue;

      recentlyEmitted.set(key, now);
      lastSpeaker = caption.speaker || lastSpeaker;
      captionsSeenAt = now;
      console.log('[BridgeSign][scraper] Caption emitted', caption);
      captionCallback({
        speaker: caption.speaker,
        text: caption.text,
        partial: true,
      });
    }
  }

  function processCaptionsNow() {
    if (!isActive) return;
    const captions = collectCaptions();
    if (captions.length) {
      emitCaptions(captions);
    }
  }

  function scheduleProcess() {
    if (!isActive) return;
    if (processTimer) return;
    processTimer = window.setTimeout(() => {
      processTimer = null;
      processCaptionsNow();
    }, 120);
  }

  function attachObserver() {
    if (pageObserver) {
      pageObserver.disconnect();
      pageObserver = null;
    }

    const root = document.body || document.documentElement;
    if (!root) return;

    pageObserver = new MutationObserver(() => {
      scheduleProcess();
    });

    pageObserver.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-live', 'aria-hidden'],
    });

    console.log('[BridgeSign][scraper] Page observer attached');
  }

  function startPolling() {
    if (pollIntervalId) return;

    pollIntervalId = window.setInterval(() => {
      if (!isActive) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
        return;
      }

      processCaptionsNow();

      const staleForMs = Date.now() - captionsSeenAt;
      if (staleForMs > 4000) {
        tryEnableMeetCaptions();
      }
    }, 2000);
  }

  function tryEnableMeetCaptions() {
    const buttons = document.querySelectorAll('button, div[role="button"]');
    for (const btn of buttons) {
      const label = normalizeText(
        btn.getAttribute('aria-label') ||
        btn.getAttribute('data-tooltip') ||
        btn.textContent
      ).toLowerCase();

      if (!label) continue;
      if (
        !label.includes('caption') &&
        !label.includes('subtitle') &&
        !label.includes('closed caption') &&
        label !== 'cc'
      ) {
        continue;
      }

      const pressed = btn.getAttribute('aria-pressed');
      if (pressed === 'true') {
        console.log('[BridgeSign][scraper] Meet captions already enabled');
        return true;
      }

      btn.click();
      console.log('[BridgeSign][scraper] Auto-enabled Meet captions');
      return true;
    }

    return false;
  }

  function areCaptionsActive() {
    if (captionContainer && isVisible(captionContainer)) {
      return true;
    }
    return Date.now() - captionsSeenAt < 5000;
  }

  function start(callback, options = {}) {
    console.log('[BridgeSign][scraper] start called', { options, alreadyActive: isActive });
    if (isActive) {
      return { active: true, captionsDetected: areCaptionsActive() };
    }

    captionCallback = callback;
    isActive = true;
    lastSpeaker = '';
    captionsSeenAt = 0;
    recentlyEmitted.clear();

    attachObserver();
    processCaptionsNow();

    if (!areCaptionsActive() && options.autoEnable !== false) {
      tryEnableMeetCaptions();
    }

    startPolling();
    return { active: true, captionsDetected: areCaptionsActive() };
  }

  function stop() {
    console.log('[BridgeSign][scraper] stop called');
    isActive = false;

    if (pageObserver) {
      pageObserver.disconnect();
      pageObserver = null;
    }

    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }

    if (processTimer) {
      clearTimeout(processTimer);
      processTimer = null;
    }

    captionCallback = null;
    captionContainer = null;
    lastSpeaker = '';
    captionsSeenAt = 0;
    recentlyEmitted.clear();
  }

  function isRunning() {
    return isActive;
  }

  return { start, stop, isRunning, areCaptionsActive, tryEnableMeetCaptions };
})();

if (typeof window !== 'undefined') {
  window.MeetCaptionScraper = MeetCaptionScraper;
}

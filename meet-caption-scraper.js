// BridgeSign Meet Caption Scraper
// Uses MutationObserver to read Google Meet's built-in Closed Captions
// and exposes them to content.js so the signer can see what others are saying.

(function () {
  'use strict';

  if (window.__BridgeSignCaptionScraper) return;

  let observer = null;
  let callback = null;
  let debounceTimer = null;
  const recentCaptions = new Map();

  const CAPTION_SELECTORS = [
    '[aria-live="polite"]',
    '[aria-live="assertive"]',
    '[role="status"]',
    '[role="log"]',
    'div[class*="iOzk7"]',
    'div[class*="TBMuR"]',
    'div[class*="a4cQT"]',
    'span[class*="CNusmb"]',
  ];

  const SYSTEM_ANNOUNCEMENT_PATTERNS = [
    /\b(joined|left|joining|rejoined)\b/i,
    /\b(raised hand|lowered hand)\b/i,
    /\b(started presenting|stopped presenting|is presenting)\b/i,
    /\b(muted|unmuted|turned captions on|turned captions off)\b/i,
    /\b(recording started|recording stopped)\b/i,
    /\b(entered the meeting|left the meeting)\b/i,
    /се присъедини/i,
    /напусна/i,
    /влезе в срещата/i,
    /излезе от срещата/i,
    /вдигна ръка/i,
    /свали ръка/i,
    /започна да представя/i,
    /спря да представя/i,
    /пусна надписите/i,
    /спря надписите/i,
  ];

  function normalizeText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function pruneRecentCaptions(now = Date.now()) {
    for (const [key, ts] of recentCaptions.entries()) {
      if (now - ts > 4000) {
        recentCaptions.delete(key);
      }
    }
  }

  function isSystemAnnouncement(text) {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) return false;
    return SYSTEM_ANNOUNCEMENT_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  function isVisible(el) {
    if (!(el instanceof Element)) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0
      && rect.height > 0
      && style.visibility !== 'hidden'
      && style.display !== 'none';
  }

  function isLikelyCaptionNode(el) {
    if (!(el instanceof Element) || !isVisible(el)) return false;
    if (el.querySelector('button, input, textarea')) return false;

    const text = normalizeText(el.innerText);
    if (!text || text.length < 2 || text.length > 280) return false;

    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const isCentered = Math.abs(centerX - window.innerWidth / 2) < window.innerWidth * 0.35;
    const isBottomBand = rect.top >= window.innerHeight * 0.38 && rect.bottom <= window.innerHeight;
    const isLiveRegion = el.matches('[aria-live], [role="status"], [role="log"]');
    const lines = (el.innerText || '').split('\n').map(normalizeText).filter(Boolean);

    return rect.height <= 240 && lines.length <= 4 && (isLiveRegion || (isCentered && isBottomBand));
  }

  function collectCandidateRoots(mutations = []) {
    const roots = new Set();

    function addNode(node) {
      let el = node instanceof Element ? node : node && node.parentElement;
      let depth = 0;

      while (el && depth < 5) {
        if (isLikelyCaptionNode(el)) {
          roots.add(el);
        }
        el = el.parentElement;
        depth++;
      }
    }

    for (const selector of CAPTION_SELECTORS) {
      document.querySelectorAll(selector).forEach((el) => addNode(el));
    }

    for (const mutation of mutations) {
      addNode(mutation.target);
      mutation.addedNodes.forEach((node) => addNode(node));
    }

    return Array.from(roots);
  }

  function collapseLines(lines) {
    const result = [];

    for (const rawLine of lines) {
      const line = normalizeText(rawLine);
      if (!line) continue;
      if (result[result.length - 1] === line) continue;
      result.push(line);
    }

    return result;
  }

  function extractCaption(root) {
    if (!root) return null;

    const lines = collapseLines((root.innerText || '').split('\n'));
    if (!lines.length) return null;

    const combined = normalizeText(lines.join(' '));
    if (!combined || isSystemAnnouncement(combined)) return null;

    let speaker = 'Them';
    let text = combined;

    if (lines.length > 1 && lines[0].length <= 40) {
      speaker = lines[0];
      text = lines.slice(1).join(' ');
    }

    text = normalizeText(text);
    if (!text || isSystemAnnouncement(`${speaker} ${text}`)) return null;

    return { speaker, text };
  }

  function emitCaption(entry) {
    if (!callback || !entry || !entry.text) return;

    const now = Date.now();
    const key = `${entry.speaker}|${entry.text}`.toLowerCase();
    pruneRecentCaptions(now);

    if (recentCaptions.has(key)) return;

    recentCaptions.set(key, now);
    callback(entry);
  }

  function scanCaptions(mutations = []) {
    const roots = collectCandidateRoots(mutations);
    for (const root of roots) {
      emitCaption(extractCaption(root));
    }
  }

  function startObserving(cb) {
    callback = cb;

    observer = new MutationObserver((mutations) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        scanCaptions(mutations);
      }, 120);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    scanCaptions();
  }

  function stopObserving() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(debounceTimer);
    callback = null;
    recentCaptions.clear();
  }

  // ==================== PUBLIC API ====================
  window.__BridgeSignCaptionScraper = {
    /**
     * Start scraping Meet's native captions.
     * @param {Function} cb - Called with { speaker: string, text: string } on each new caption
     */
    start(cb) {
      stopObserving(); // Clean up any previous instance
      startObserving(cb);
    },

    /** Stop observing captions. */
    stop() {
      stopObserving();
    },

    /** Check if currently observing. */
    isActive() {
      return observer !== null;
    }
  };
})();

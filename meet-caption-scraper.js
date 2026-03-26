// BridgeSign Meet Caption Scraper
// Uses MutationObserver to read Google Meet's built-in Closed Captions
// and exposes them to content.js so the signer can see what others are saying.

(function () {
  'use strict';

  if (window.__BridgeSignCaptionScraper) return;

  let observer = null;
  let callback = null;
  let lastText = '';
  let debounceTimer = null;

  // Known CSS selectors for Google Meet's caption container.
  // Meet updates its DOM frequently, so we try multiple selectors.
  const CAPTION_SELECTORS = [
    'div[class*="iOzk7"]',              // Meet caption container (2024-2026)
    'div[class*="TBMuR"]',              // Alternative caption wrapper
    'div[jscontroller][jsname] span[class*="CNusmb"]', // Individual caption spans
    'div[class*="a4cQT"]',              // Caption region
  ];

  // Fallback: find any container that looks like captions
  function findCaptionContainer() {
    // Try known selectors first
    for (const sel of CAPTION_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    // Heuristic fallback: look for a container at the bottom of the screen
    // with short text nodes that updates frequently
    const candidates = document.querySelectorAll('div[jscontroller]');
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      // Captions are typically at the bottom third of the viewport
      if (rect.top > window.innerHeight * 0.6 && rect.height < 200) {
        const text = el.innerText.trim();
        if (text.length > 0 && text.length < 500) {
          return el;
        }
      }
    }

    return null;
  }

  function extractCaptions(container) {
    if (!container) return [];

    const results = [];

    // Method 1: Look for speaker name + text pairs
    // Meet typically renders: <div>[Speaker Name]</div><div>[Caption Text]</div>
    const spans = container.querySelectorAll('span');
    if (spans.length >= 2) {
      // Group consecutive spans: first = name, rest = text
      let currentSpeaker = '';
      let currentText = '';

      for (const span of spans) {
        const text = span.innerText.trim();
        if (!text) continue;

        // Heuristic: speaker names are short and don't end with punctuation
        if (text.length < 30 && !text.match(/[.!?,;:]$/) && !currentSpeaker) {
          currentSpeaker = text;
        } else {
          currentText += (currentText ? ' ' : '') + text;
        }
      }

      if (currentText) {
        results.push({
          speaker: currentSpeaker || 'Them',
          text: currentText
        });
      }
    }

    // Method 2: Simple innerText fallback
    if (results.length === 0) {
      const raw = container.innerText.trim();
      if (raw && raw !== lastText) {
        results.push({ speaker: 'Them', text: raw });
      }
    }

    return results;
  }

  function startObserving(cb) {
    callback = cb;

    // Watch the entire body for caption containers appearing/updating
    observer = new MutationObserver(() => {
      // Debounce to avoid firing on every character
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const container = findCaptionContainer();
        if (!container) return;

        const captions = extractCaptions(container);
        for (const cap of captions) {
          if (cap.text && cap.text !== lastText) {
            lastText = cap.text;
            if (callback) callback(cap);
          }
        }
      }, 150);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function stopObserving() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(debounceTimer);
    callback = null;
    lastText = '';
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

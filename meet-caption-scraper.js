// SignFlow Meet Caption Scraper
// Scrapes Google Meet's built-in captions via MutationObserver
// so the ASL-signer user gets live subtitles without requiring
// other participants to install the extension.

const MeetCaptionScraper = (() => {
  'use strict';

  // ==================== STATE ====================
  let isActive = false;
  let observer = null;
  let captionCallback = null;
  let pollIntervalId = null;
  let captionContainer = null;
  let lastCaptionText = '';
  let lastSpeaker = '';

  // ==================== SELECTOR STRATEGIES ====================
  // Google Meet changes DOM structure frequently. We use multiple
  // strategies to find the caption container, ordered by reliability.

  const CAPTION_SELECTORS = [
    // 2025-2026 known caption container selectors
    'div.a4cQT',                           // Classic container
    'div[jscontroller] div.iOzk7',         // Caption text wrapper
    'div.TBMuR.bj4p3b',                    // Outer caption bar
    'div[class*="caption"]',               // Fuzzy fallback
  ];

  // Speaker name selectors within a caption bubble
  const SPEAKER_SELECTORS = [
    'div.zs7s8d.jxFHg',     // Speaker name element
    'span.CNusmb',           // Alternative speaker name
    'div[class*="speaker"]', // Fuzzy fallback
  ];

  // Caption text selectors within a caption bubble
  const TEXT_SELECTORS = [
    'span.VbkSUe',             // Caption text span
    'div.iTTPOb.VbkSUe span',  // Nested text span
    'span[class*="caption"]',  // Fuzzy fallback
  ];

  // ==================== FINDING CAPTIONS ====================

  /**
   * Attempts to locate the caption container using multiple selector strategies.
   * Falls back to a heuristic search if none of the known selectors work.
   */
  function findCaptionContainer() {
    // Strategy 1: Try known selectors
    for (const sel of CAPTION_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.offsetHeight > 0) return el;
    }

    // Strategy 2: Heuristic — look for a bottom-positioned container
    // with short, rapidly changing text content (caption-like behavior)
    const candidates = document.querySelectorAll('div[jscontroller]');
    for (const c of candidates) {
      const rect = c.getBoundingClientRect();
      // Captions usually sit in the bottom 20% of the viewport
      if (
        rect.bottom > window.innerHeight * 0.75 &&
        rect.height > 20 &&
        rect.height < 200 &&
        c.innerText.trim().length > 0
      ) {
        return c;
      }
    }
  }

  function isSystemAnnouncement(text) {
    const normalized = normalizeText(text).toLowerCase();
    if (!normalized) return false;
    return SYSTEM_ANNOUNCEMENT_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  /**
   * Extract speaker name and text from a caption element.
   */
  function extractCaptionData(container) {
    const results = [];

    // Google Meet renders captions as individual bubbles per speaker.
    // Each bubble usually has a speaker name and a text span.
    const seen = new Set();

    // Attempt structured extraction first
    for (const sel of SPEAKER_SELECTORS) {
      const speakerEls = container.querySelectorAll(sel);
      for (const speakerEl of speakerEls) {
        const speaker = speakerEl.textContent.trim();
        if (!speaker) continue;

        // Find the sibling/nearby text element
        const parent = speakerEl.closest('div[jscontroller]') || speakerEl.parentElement;
        let text = '';
        for (const tSel of TEXT_SELECTORS) {
          const textEls = parent ? parent.querySelectorAll(tSel) : [];
          for (const te of textEls) {
            text += te.textContent.trim() + ' ';
          }
          if (text.trim()) break;
        }

        if (text.trim() && !seen.has(speaker + text.trim())) {
          seen.add(speaker + text.trim());
          results.push({ speaker, text: text.trim() });
        }
      }
    }

    // Fallback: grab all text from the container as a single caption
    if (results.length === 0) {
      const fullText = container.innerText.trim();
      if (fullText) {
        // Try to split "Speaker Name\nCaption text" pattern
        const lines = fullText.split('\n').filter(l => l.trim());
        if (lines.length >= 2) {
          // Heuristic: if first line is short (< 30 chars) it's likely the speaker name
          const potentialSpeaker = lines[0].trim();
          const potentialText = lines.slice(1).join(' ').trim();
          if (potentialSpeaker.length < 30 && potentialText.length > 0) {
            results.push({ speaker: potentialSpeaker, text: potentialText });
          } else {
            results.push({ speaker: 'Speaker', text: fullText });
          }
        } else if (lines.length === 1) {
          results.push({ speaker: lastSpeaker || 'Speaker', text: lines[0].trim() });
        }
      }
    }

    return Array.from(roots);
  }

  // ==================== OBSERVER ====================

  /**
   * Sets up a MutationObserver on the caption container to detect new/changed captions.
   */
  function attachObserver(container) {
    if (observer) observer.disconnect();

    captionContainer = container;

    observer = new MutationObserver((mutations) => {
      if (!isActive || !captionCallback) return;

      // Debounce: only process if there's actual new content
      const currentText = container.innerText.trim();
      if (currentText === lastCaptionText) return;
      lastCaptionText = currentText;

      const captions = extractCaptionData(container);
      for (const cap of captions) {
        if (cap.speaker) lastSpeaker = cap.speaker;
        captionCallback({
          speaker: cap.speaker,
          text: cap.text,
          partial: true, // Meet captions update in-place, treat as partial until they disappear
        });
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    console.log('[SignFlow CaptionScraper] Observer attached to caption container');
  }

  /**
   * Polls for the caption container until it appears.
   * Meet may not render captions until the user enables CC.
   */
  function startPolling() {
    if (pollIntervalId) return;

    pollIntervalId = setInterval(() => {
      if (!isActive) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
        return;
      }

      const container = findCaptionContainer();
      if (container && container !== captionContainer) {
        attachObserver(container);
      } else if (!container && captionContainer) {
        // Captions were turned off
        captionContainer = null;
        lastCaptionText = '';
        if (observer) observer.disconnect();
      }
    }, 2000);
  }

  // ==================== ENABLE CAPTIONS HELPER ====================

  /**
   * Attempts to programmatically enable Google Meet's built-in captions
   * by finding and clicking the CC button.
   * Returns true if the button was found and clicked.
   */
  function tryEnableMeetCaptions() {
    // Strategy 1: aria-label based (most reliable)
    const buttons = document.querySelectorAll('button[aria-label]');
    for (const btn of buttons) {
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (
        label.includes('caption') ||
        label.includes('subtitle') ||
        label.includes('closed caption') ||
        label.includes('cc')
      ) {
        // Check if captions are currently OFF (button not pressed)
        const pressed = btn.getAttribute('aria-pressed');
        if (pressed !== 'true') {
          btn.click();
          console.log('[SignFlow CaptionScraper] Auto-enabled Meet captions');
          return true;
        } else {
          console.log('[SignFlow CaptionScraper] Meet captions already enabled');
          return true;
        }
      }
    }

    // Strategy 2: data-tooltip based
    const allButtons = document.querySelectorAll('button');
    for (const btn of allButtons) {
      const tooltip = (btn.getAttribute('data-tooltip') || '').toLowerCase();
      if (tooltip.includes('caption') || tooltip.includes('subtitle')) {
        btn.click();
        console.log('[SignFlow CaptionScraper] Auto-enabled Meet captions via tooltip');
        return true;
      }
    }

    return false;
  }

  /**
   * Check if Meet captions appear to be currently active.
   */
  function areCaptionsActive() {
    return captionContainer !== null && captionContainer.offsetHeight > 0;
  }

  // ==================== PUBLIC API ====================

  /**
   * Start scraping Meet captions.
   * @param {Function} callback - Called with { speaker, text, partial } for each caption update.
   * @param {Object} options - { autoEnable: boolean } whether to auto-click the CC button.
   * @returns {{ active: boolean, captionsDetected: boolean }}
   */
  function start(callback, options = {}) {
    if (isActive) return { active: true, captionsDetected: areCaptionsActive() };

    captionCallback = callback;
    isActive = true;
    lastCaptionText = '';
    lastSpeaker = '';

    // Try to find the caption container immediately
    const container = findCaptionContainer();
    if (container) {
      attachObserver(container);
    } else if (options.autoEnable !== false) {
      // Try to enable Meet captions
      tryEnableMeetCaptions();
    }

    // Start polling for container (in case captions are enabled later)
    startPolling();

    return { active: true, captionsDetected: !!container };
  }

  /**
   * Stop scraping.
   */
  function stop() {
    isActive = false;

    if (observer) {
      observer.disconnect();
      observer = null;
    }

    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }

    captionContainer = null;
    captionCallback = null;
    lastCaptionText = '';
    lastSpeaker = '';

    console.log('[SignFlow CaptionScraper] Stopped');
  }

  /**
   * Returns whether the scraper is currently active.
   */
  function isRunning() {
    return isActive;
  }

  return { start, stop, isRunning, areCaptionsActive, tryEnableMeetCaptions };
})();

// Export for content script
if (typeof window !== 'undefined') {
  window.MeetCaptionScraper = MeetCaptionScraper;
}

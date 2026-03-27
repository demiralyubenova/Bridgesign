// SignFlow ASL playback panel
// Uses validated clip assets when available and readable sign cards when a clip is missing.

const SignPlayer = (() => {
  'use strict';

  function playerLog(message, details) {
    if (details === undefined) {
      console.log(`[BridgeSign][player] ${message}`);
      return;
    }
    console.log(`[BridgeSign][player] ${message}`, details);
  }

  const ASL_ALPHABET_CHART_URL = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
    ? chrome.runtime.getURL('assets/asl-alphabet-chart.png')
    : '';

  const ASL_FINGERSPELL_TILE_MAP = {
    A: { col: 0, row: 0 },
    B: { col: 1, row: 0 },
    C: { col: 2, row: 0 },
    D: { col: 3, row: 0 },
    E: { col: 4, row: 0 },
    F: { col: 5, row: 0 },
    G: { col: 6, row: 0 },
    H: { col: 0, row: 1 },
    I: { col: 1, row: 1 },
    J: { col: 2, row: 1 },
    K: { col: 3, row: 1 },
    L: { col: 4, row: 1 },
    M: { col: 5, row: 1 },
    N: { col: 6, row: 1 },
    O: { col: 0, row: 2 },
    P: { col: 1, row: 2 },
    Q: { col: 2, row: 2 },
    R: { col: 3, row: 2 },
    S: { col: 4, row: 2 },
    T: { col: 5, row: 2 },
    U: { col: 6, row: 2 },
    V: { col: 0, row: 3 },
    W: { col: 1, row: 3 },
    X: { col: 2, row: 3 },
    Y: { col: 3, row: 3 },
    Z: { col: 4, row: 3 },
  };

  const state = {
    aslChartAvailable: null,
    aslChartPromise: null,
    queue: [],
    currentManifest: null,
    currentPlaybackToken: 0,
    currentTimeoutId: null,
    currentVideoHandler: null,
    clipCache: new Map(),
    mounted: false,
    refs: null,
    lastCompletedManifest: null,
  };

  function hasGestureUnits(manifest) {
    if (!manifest || !Array.isArray(manifest.units) || !manifest.units.length) {
      return false;
    }

    return manifest.units.some((unit) => {
      if (!unit || !unit.id) return false;
      return !unit.id.startsWith('FS-') && unit.id !== 'NO-SIGN-PLAN';
    });
  }

  function hasPlayableUnits(manifest) {
    if (!manifest || !Array.isArray(manifest.units) || !manifest.units.length) {
      return false;
    }

    return manifest.units.some((unit) => unit && unit.id && unit.id !== 'NO-SIGN-PLAN');
  }

  function setVisible(visible) {
    if (!state.refs || !state.refs.section) return;
    state.refs.section.style.display = visible ? '' : 'none';
  }

  function mount(refs) {
    playerLog('Mounting SignPlayer');
    state.queue = [];
    stopCurrentPlayback();
    state.lastCompletedManifest = null;
    state.refs = refs;
    state.mounted = true;
    ensureAslChartAvailability();
    setVisible(true);
    updateStatus('Waiting for ASL plan');
    updateQueue([]);
    updateReplayButton();
    if (state.refs && state.refs.label) {
      state.refs.label.textContent = '-';
    }
  }

  function enqueueManifest(manifest) {
    playerLog('enqueueManifest called', manifest);
    if (!manifest || !Array.isArray(manifest.units) || !manifest.units.length) {
      playerLog('Ignoring empty manifest');
      return;
    }

    if (!hasPlayableUnits(manifest)) {
      playerLog('Manifest has no playable units', manifest);
      showUnavailableManifest(manifest);
      return;
    }

    setVisible(true);

    if (manifest.priority === 'urgent') {
      playManifest(manifest, true);
      return;
    }

    playManifest(manifest, false);
  }

  function replayLast() {
    playerLog('Replaying last manifest', state.lastCompletedManifest);
    if (!state.lastCompletedManifest) return;
    enqueueManifest(JSON.parse(JSON.stringify(state.lastCompletedManifest)));
  }

  function reset() {
    playerLog('Resetting SignPlayer');
    state.queue = [];
    stopCurrentPlayback();
    state.lastCompletedManifest = null;
    updateReplayButton();
    updateQueue([]);
    updateStatus('Waiting for ASL plan');
    if (state.refs && state.refs.label) {
      state.refs.label.textContent = '-';
    }
    setVisible(true);
  }

  function updateStatus(message) {
    if (state.refs && state.refs.status) {
      state.refs.status.textContent = message;
    }
  }

  function updateQueue(units) {
    if (!state.refs || !state.refs.unitList) return;

    if (!units.length) {
      state.refs.unitList.innerHTML = '<div class="sf-sign-placeholder">ASL clips, spelled letters, or fallback words will appear here for finalized speech.</div>';
      return;
    }

    state.refs.unitList.innerHTML = units.map((unit) => {
      const presentation = getUnitPresentation(unit);
      const markerHtml = presentation.glyphStyle
        ? `<span class="sf-sign-chip-glyph" style="${presentation.glyphStyle}" aria-hidden="true"></span>`
        : `<span class="sf-sign-chip-badge">${escapeHtml(presentation.badge)}</span>`;
      return `
        <div class="sf-sign-chip ${presentation.chipClass}">
          ${markerHtml}
          <span>${escapeHtml(presentation.label)}</span>
        </div>
      `;
    }).join('');
  }

  function updateReplayButton() {
    if (!state.refs || !state.refs.replayButton) return;
    state.refs.replayButton.disabled = !state.lastCompletedManifest;
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }

  async function playManifest(manifest, interrupt = false) {
    playerLog('Starting manifest playback', {
      interrupt,
      text: manifest && manifest.text,
      mode: manifest && manifest.mode,
      units: manifest && manifest.units ? manifest.units.map((unit) => unit.id) : [],
    });
    if (!state.mounted || !manifest || !Array.isArray(manifest.units) || !manifest.units.length) {
      playerLog('Aborting playback because player is not mounted or manifest is invalid');
      return;
    }

    if (interrupt) {
      state.queue = [];
      stopCurrentPlayback();
    } else if (state.currentManifest) {
      state.queue.push(manifest);
      updateStatus(`Queued ${state.queue.length} ASL phrase${state.queue.length > 1 ? 's' : ''}`);
      return;
    }

    state.currentManifest = manifest;
    const token = ++state.currentPlaybackToken;
    const playbackLabel = manifest.mode === 'fingerspell' ? 'Fingerspelling' : 'ASL';
    const cardCount = manifest.card_count || 0;
    const fingerspellCount = manifest.fingerspell_count || 0;
    let fallbackSummary = '';
    if (cardCount > 0) {
      fallbackSummary = ` (${cardCount} word fallback${cardCount > 1 ? 's' : ''})`;
    } else if (fingerspellCount > 0) {
      fallbackSummary = ` (${fingerspellCount} fingerspelled)`;
    }
    updateStatus(`${manifest.priority === 'urgent' ? 'Urgent' : 'Playing'} ${playbackLabel} for: ${manifest.text}${fallbackSummary}`);
    updateQueue(manifest.units);

    for (const unit of manifest.units) {
      if (token !== state.currentPlaybackToken) {
        playerLog('Playback token changed, aborting remaining units');
        return;
      }
      await playUnit(unit, token);
    }

    if (token !== state.currentPlaybackToken) {
      return;
    }

    state.lastCompletedManifest = manifest;
    state.currentManifest = null;
    updateReplayButton();

    if (state.queue.length) {
      const nextManifest = state.queue.shift();
      playManifest(nextManifest, false);
      return;
    }

    updateQueue([]);
    updateStatus('ASL plan complete');
    playerLog('Manifest playback complete', { text: manifest.text });
  }

  async function playUnit(unit, token) {
    return new Promise(async (resolve) => {
      playerLog('Playing unit', unit);
      const finish = () => {
        if (token !== state.currentPlaybackToken) {
          resolve();
          return;
        }

        if (state.refs && state.refs.fallbackCard) {
          state.refs.fallbackCard.style.display = 'none';
        }
        if (state.refs && state.refs.video) {
          clearVideoHandler();
          state.refs.video.pause();
          state.refs.video.style.display = 'none';
        }

        state.currentTimeoutId = null;
        resolve();
      };

      const presentation = getUnitPresentation(unit);
      if (state.refs && state.refs.label) {
        state.refs.label.textContent = presentation.currentLabel;
      }

      if (unit.url && state.refs && state.refs.video) {
        clearVideoHandler();
        state.refs.video.style.display = 'block';
        state.currentVideoHandler = finish;
        state.refs.video.addEventListener('ended', state.currentVideoHandler, { once: true });

        const resolvedUrl = await resolveClipUrl(unit.url);
        if (!resolvedUrl) {
          playerLog('Clip URL could not be resolved, showing fallback card', unit);
          showFallbackCard(unit);
          scheduleFinish(unit.duration_ms, finish);
          return;
        }

        state.refs.video.src = resolvedUrl;
        state.refs.video.play().catch(() => {
          playerLog('Video playback failed, switching to fallback card', unit);
          showFallbackCard(unit);
          scheduleFinish(unit.duration_ms, finish);
        });
        return;
      }

      playerLog('No video URL present, showing fallback card', unit);
      showFallbackCard(unit);
      scheduleFinish(unit.duration_ms, finish);
    });
  }

  function showFallbackCard(unit) {
    if (!state.refs || !state.refs.fallbackCard) return;
    const presentation = getUnitPresentation(unit);
    state.refs.fallbackCard.classList.toggle('is-word-card', presentation.kind === 'word');
    state.refs.fallbackCard.classList.toggle('is-fingerspell-card', presentation.kind === 'fingerspell');
    state.refs.fallbackCard.innerHTML = presentation.kind === 'fingerspell' && presentation.glyphStyle
      ? `
        <div class="sf-sign-fallback-inner sf-sign-fallback-inner-word">
          <div class="sf-sign-fallback-kicker">${escapeHtml(presentation.kicker)}</div>
          <div class="sf-sign-fallback-glyph" style="${presentation.glyphStyle}" aria-hidden="true"></div>
          <div class="sf-sign-fallback-text sf-sign-fallback-text-word">${escapeHtml(presentation.label)}</div>
        </div>
      `
      : (presentation.kind === 'word' || presentation.kind === 'fingerspell')
      ? `
        <div class="sf-sign-fallback-inner sf-sign-fallback-inner-word">
          <div class="sf-sign-fallback-kicker">${escapeHtml(presentation.kicker)}</div>
          <div class="sf-sign-fallback-text sf-sign-fallback-text-word">${escapeHtml(presentation.label)}</div>
        </div>
      `
      : `
        <div class="sf-sign-fallback-inner sf-sign-fallback-inner-word">
          <div class="sf-sign-fallback-kicker">${escapeHtml(presentation.kicker)}</div>
          <div class="sf-sign-fallback-text">${escapeHtml(presentation.label)}</div>
        </div>
      `;
    state.refs.fallbackCard.style.display = 'flex';
    if (state.refs.video) {
      state.refs.video.style.display = 'none';
    }
  }

  function showUnavailableManifest(manifest) {
    playerLog('Showing unavailable manifest', manifest);
    stopCurrentPlayback();
    state.queue = [];
    state.currentManifest = null;
    state.lastCompletedManifest = null;
    updateReplayButton();
    setVisible(true);
    updateStatus('No ASL gesture available');
    if (state.refs && state.refs.label) {
      state.refs.label.textContent = (manifest.text || 'UNKNOWN').toUpperCase();
    }
    if (state.refs && state.refs.unitList) {
      state.refs.unitList.innerHTML = `<div class="sf-sign-placeholder">No ASL gesture available yet for "${escapeHtml(manifest.text || 'this phrase')}".</div>`;
    }
    if (state.refs && state.refs.fallbackCard) {
      state.refs.fallbackCard.classList.remove('is-word-card');
      state.refs.fallbackCard.classList.remove('is-fingerspell-card');
      state.refs.fallbackCard.innerHTML = `
        <div class="sf-sign-fallback-inner">
          <div class="sf-sign-fallback-kicker">Unavailable</div>
          <div class="sf-sign-fallback-text">No ASL Gesture</div>
        </div>
      `;
      state.refs.fallbackCard.style.display = 'flex';
    }
    if (state.refs && state.refs.video) {
      state.refs.video.style.display = 'none';
    }
  }

  function ensureAslChartAvailability() {
    if (!ASL_ALPHABET_CHART_URL) {
      state.aslChartAvailable = false;
      return Promise.resolve(false);
    }

    if (state.aslChartAvailable !== null) {
      return Promise.resolve(state.aslChartAvailable);
    }

    if (state.aslChartPromise) {
      return state.aslChartPromise;
    }

    state.aslChartPromise = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        state.aslChartAvailable = true;
        if (state.currentManifest && Array.isArray(state.currentManifest.units)) {
          updateQueue(state.currentManifest.units);
        }
        resolve(true);
      };
      image.onerror = () => {
        state.aslChartAvailable = false;
        resolve(false);
      };
      image.src = ASL_ALPHABET_CHART_URL;
    });

    return state.aslChartPromise;
  }

  function scheduleFinish(durationMs, finish) {
    state.currentTimeoutId = setTimeout(finish, Math.max(durationMs || 1000, 600));
  }

  async function resolveClipUrl(url) {
    if (!url) return null;
    if (state.clipCache.has(url)) {
      playerLog('Using cached clip URL', { url });
      return state.clipCache.get(url);
    }

    try {
      playerLog('Fetching clip URL', { url });
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Clip responded with ${response.status}`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      state.clipCache.set(url, objectUrl);
      playerLog('Clip fetched successfully', { url, objectUrl });
      return objectUrl;
    } catch (error) {
      playerLog('Clip fetch failed', { url, error: error && error.message ? error.message : error });
      console.warn('[SignFlow] Failed to load sign clip:', error && error.message ? error.message : error);
      return null;
    }
  }

  function clearVideoHandler() {
    if (state.refs && state.refs.video && state.currentVideoHandler) {
      state.refs.video.removeEventListener('ended', state.currentVideoHandler);
    }
    state.currentVideoHandler = null;
  }

  function stopCurrentPlayback() {
    playerLog('Stopping current playback');
    state.currentPlaybackToken += 1;

    if (state.currentTimeoutId) {
      clearTimeout(state.currentTimeoutId);
      state.currentTimeoutId = null;
    }

    if (state.refs && state.refs.video) {
      clearVideoHandler();
      state.refs.video.pause();
      state.refs.video.removeAttribute('src');
      state.refs.video.load();
      state.refs.video.style.display = 'none';
    }

    if (state.refs && state.refs.fallbackCard) {
      state.refs.fallbackCard.classList.remove('is-word-card');
      state.refs.fallbackCard.classList.remove('is-fingerspell-card');
      state.refs.fallbackCard.style.display = 'none';
      state.refs.fallbackCard.innerHTML = '';
    }

    state.currentManifest = null;
  }

  function getUnitPresentation(unit) {
    const kind = getUnitKind(unit);
    const rawLabel = normalizeLabel(unit, kind);
    const glyphStyle = resolveGlyphStyle(unit, kind);
    return {
      badge: resolveBadge(unit, kind),
      chipClass: `sf-sign-chip-${kind}`,
      currentLabel: resolveCurrentLabel(rawLabel, kind),
      glyphStyle,
      kicker: resolveKicker(kind),
      kind,
      label: rawLabel,
    };
  }

  function getUnitKind(unit) {
    if (unit && unit.id && unit.id.startsWith('FS-')) {
      return 'fingerspell';
    }
    if (unit && unit.type === 'card' && unit.id && unit.id.startsWith('WORD-')) {
      return 'word';
    }
    return 'sign';
  }

  function normalizeLabel(unit, kind) {
    if (kind === 'fingerspell' && unit.id) {
      return unit.id.slice(3).toUpperCase();
    }
    if (unit.text) {
      if (kind === 'word') {
        return unit.text;
      }
      return unit.text.toUpperCase();
    }
    return (unit.id || 'SIGN').replace(/-/g, ' ');
  }

  function resolveBadge(unit, kind) {
    if (kind === 'fingerspell' && unit.id) {
      return unit.id.slice(3).toUpperCase();
    }
    if (kind === 'word') {
      return 'WORD';
    }
    return 'SIGN';
  }

  function resolveKicker(kind) {
    if (kind === 'fingerspell') {
      return 'Finger Spelling';
    }
    if (kind === 'word') {
      return 'Word Fallback';
    }
    return 'ASL Sign';
  }

  function resolveCurrentLabel(label, kind) {
    if (kind === 'fingerspell') {
      return `SPELL: ${label}`;
    }
    if (kind === 'word') {
      return `WORD: ${label}`;
    }
    return `SIGN: ${label}`;
  }

  function resolveGlyphStyle(unit, kind) {
    if (kind !== 'fingerspell' || state.aslChartAvailable !== true || !unit || !unit.id) {
      return '';
    }

    const letter = unit.id.slice(3).toUpperCase();
    const tile = ASL_FINGERSPELL_TILE_MAP[letter];
    if (!tile) {
      return '';
    }

    const xPercent = tile.col === 0 ? 0 : (tile.col / 6) * 100;
    const yPercent = tile.row === 0 ? 0 : (tile.row / 3) * 100;
    return [
      `background-image:url('${ASL_ALPHABET_CHART_URL}')`,
      'background-repeat:no-repeat',
      'background-size:700% 400%',
      `background-position:${xPercent}% ${yPercent}%`,
    ].join(';');
  }

  return {
    mount,
    enqueueManifest,
    replayLast,
    reset,
  };
})();

if (typeof window !== 'undefined') {
  window.SignPlayer = SignPlayer;
}

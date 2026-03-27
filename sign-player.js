// SignFlow ASL playback panel
// Uses validated clip assets when available and readable sign cards when a clip is missing.

const SignPlayer = (() => {
  'use strict';

  const UNIT_EMOJI_MAP = {
    'HELLO': '👋',
    'GOODBYE': '👋',
    'GOOD-MORNING': '🌅',
    'GOOD-AFTERNOON': '☀️',
    'GOOD-EVENING': '🌆',
    'THANK-YOU': '🙏',
    'THANK-YOU-TIME': '🙏🕒',
    'PLEASE': '🤲',
    'PLEASE-WAIT': '✋⏳',
    'WAIT': '✋',
    'STOP': '🛑',
    'YES': '👍',
    'NO': '👎',
    'MAYBE': '🤷',
    'OKAY': '👌',
    'WELCOME': '🤗',
    'SORRY': '😔',
    'EXCUSE-ME': '🙋',
    'I-UNDERSTAND': '🧠✅',
    'I-DO-NOT-UNDERSTAND': '🧠❌',
    'CAN-YOU-REPEAT-THAT': '🔁❓',
    'PLEASE-REPEAT-THAT': '🤲🔁',
    'PLEASE-SLOW-DOWN': '🤲🐢',
    'PLEASE-SPEAK-SLOWLY': '🤲🗣️🐢',
    'PLEASE-SIGN-SLOWLY': '🤲🤟🐢',
    'I-NEED-HELP': '🆘',
    'CAN-YOU-HELP-ME': '❓🤝',
    'YOU-NEED-HELP': '👉🆘',
    'EMERGENCY': '🚨',
    'CALL-911': '📞🚨',
    'WHAT-YOUR-NAME': '❓🪪',
    'MY-NAME': '🙋🪪',
    'WHAT-TIME': '❓🕒',
    'MEETING-START-NOW': '🎬🕒',
    'MEETING-FINISH': '🏁',
    'START': '▶️',
    'CAN-WE-START': '❓▶️',
    'PLEASE-JOIN-MEETING': '🤲👥',
    'PLEASE-CHECK-CHAT': '🤲💬',
    'PLEASE-WRITE-DOWN': '🤲✍️',
    'PLEASE-TYPE-CHAT': '🤲⌨️💬',
    'YOU-UNDERSTAND': '👉🧠✅',
    'YOU-READY': '👉✅',
    'I-READY': '✅',
    'I-NOT-READY': '❌',
    'I-LATE': '⏰',
    'I-EARLY': '⏱️',
    'AUDIO-NOT-WORK': '🔇❌',
    'VIDEO-NOT-WORK': '📹❌',
    'CONNECTION-BAD': '📶❌',
    'INTERNET-SLOW': '🌐🐢',
    'CAN-YOU-REJOIN': '🔄❓',
    'PLEASE-REJOIN': '🤲🔄',
    'ONE-SECOND': '1️⃣',
    'ONE-MINUTE': '1️⃣⏱️',
    'SEE-YOU-LATER': '👋⏭️',
    'SEE-YOU-TOMORROW': '👋🌤️',
    'GOOD-JOB': '👏',
    'GOOD-WORK': '👏💼',
    'CAN-YOU-SEE-ME': '👀❓',
    'CAN-YOU-HEAR-ME': '👂❓',
    'WHAT-DAY-TODAY': '❓📅',
    'TODAY-MONDAY': '📅1',
    'TODAY-TUESDAY': '📅2',
    'TODAY-WEDNESDAY': '📅3',
    'TODAY-THURSDAY': '📅4',
    'TODAY-FRIDAY': '📅5',
    'TODAY-SATURDAY': '📅6',
    'TODAY-SUNDAY': '📅7',
  };

  const FINGERSPELL_EMOJI_MAP = {
    A: '✊',
    B: '✋',
    C: '🤏',
    D: '☝️',
    E: '✊',
    F: '👌',
    G: '👉',
    H: '✌️',
    I: '🤙',
    J: '🤙',
    K: '✌️',
    L: '🤘',
    M: '✊',
    N: '✊',
    O: '🫶',
    P: '👇',
    Q: '👇',
    R: '🤞',
    S: '👊',
    T: '👍',
    U: '✌️',
    V: '✌️',
    W: '🖖',
    X: '☝️',
    Y: '🤙',
    Z: '☝️',
  };

  const state = {
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
    state.queue = [];
    stopCurrentPlayback();
    state.lastCompletedManifest = null;
    state.refs = refs;
    state.mounted = true;
    setVisible(false);
    updateStatus('Waiting for ASL plan');
    updateQueue([]);
    updateReplayButton();
    if (state.refs && state.refs.label) {
      state.refs.label.textContent = '-';
    }
  }

  function enqueueManifest(manifest) {
    if (!manifest || !Array.isArray(manifest.units) || !manifest.units.length) {
      return;
    }

    if (!hasPlayableUnits(manifest)) {
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
    if (!state.lastCompletedManifest) return;
    enqueueManifest(JSON.parse(JSON.stringify(state.lastCompletedManifest)));
  }

  function reset() {
    state.queue = [];
    stopCurrentPlayback();
    state.lastCompletedManifest = null;
    updateReplayButton();
    updateQueue([]);
    updateStatus('Waiting for ASL plan');
    if (state.refs && state.refs.label) {
      state.refs.label.textContent = '-';
    }
    setVisible(false);
  }

  function updateStatus(message) {
    if (state.refs && state.refs.status) {
      state.refs.status.textContent = message;
    }
  }

  function updateQueue(units) {
    if (!state.refs || !state.refs.unitList) return;

    if (!units.length) {
      state.refs.unitList.innerHTML = '<div class="sf-sign-placeholder">ASL clips or emoji signs will appear here for finalized speech.</div>';
      return;
    }

    state.refs.unitList.innerHTML = units.map((unit) => {
      const presentation = getUnitPresentation(unit);
      return `
        <div class="sf-sign-chip">
          <span class="sf-sign-chip-emoji">${escapeHtml(presentation.emoji)}</span>
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
    if (!state.mounted || !manifest || !Array.isArray(manifest.units) || !manifest.units.length) {
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
    updateStatus(`${manifest.priority === 'urgent' ? 'Urgent' : 'Playing'} ${playbackLabel} for: ${manifest.text}`);
    updateQueue(manifest.units);

    for (const unit of manifest.units) {
      if (token !== state.currentPlaybackToken) {
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
  }

  async function playUnit(unit, token) {
    return new Promise(async (resolve) => {
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
        state.refs.label.textContent = `${presentation.emoji} ${presentation.label}`;
      }

      if (unit.url && state.refs && state.refs.video) {
        clearVideoHandler();
        state.refs.video.style.display = 'block';
        state.currentVideoHandler = finish;
        state.refs.video.addEventListener('ended', state.currentVideoHandler, { once: true });

        const resolvedUrl = await resolveClipUrl(unit.url);
        if (!resolvedUrl) {
          showFallbackCard(unit);
          scheduleFinish(unit.duration_ms, finish);
          return;
        }

        state.refs.video.src = resolvedUrl;
        state.refs.video.play().catch(() => {
          showFallbackCard(unit);
          scheduleFinish(unit.duration_ms, finish);
        });
        return;
      }

      showFallbackCard(unit);
      scheduleFinish(unit.duration_ms, finish);
    });
  }

  function showFallbackCard(unit) {
    if (!state.refs || !state.refs.fallbackCard) return;
    const presentation = getUnitPresentation(unit);
    state.refs.fallbackCard.innerHTML = `
      <div class="sf-sign-fallback-inner">
        <div class="sf-sign-fallback-emoji">${escapeHtml(presentation.emoji)}</div>
        <div class="sf-sign-fallback-text">${escapeHtml(presentation.label)}</div>
      </div>
    `;
    state.refs.fallbackCard.style.display = 'flex';
    if (state.refs.video) {
      state.refs.video.style.display = 'none';
    }
  }

  function showUnavailableManifest(manifest) {
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
      state.refs.fallbackCard.innerHTML = `
        <div class="sf-sign-fallback-inner">
          <div class="sf-sign-fallback-emoji">🤷</div>
          <div class="sf-sign-fallback-text">No ASL Gesture</div>
        </div>
      `;
      state.refs.fallbackCard.style.display = 'flex';
    }
    if (state.refs && state.refs.video) {
      state.refs.video.style.display = 'none';
    }
  }

  function scheduleFinish(durationMs, finish) {
    state.currentTimeoutId = setTimeout(finish, Math.max(durationMs || 1000, 600));
  }

  async function resolveClipUrl(url) {
    if (!url) return null;
    if (state.clipCache.has(url)) {
      return state.clipCache.get(url);
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Clip responded with ${response.status}`);
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      state.clipCache.set(url, objectUrl);
      return objectUrl;
    } catch (error) {
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
      state.refs.fallbackCard.style.display = 'none';
      state.refs.fallbackCard.innerHTML = '';
    }

    state.currentManifest = null;
  }

  function getUnitPresentation(unit) {
    const rawLabel = normalizeLabel(unit);
    const emoji = resolveEmoji(unit, rawLabel);
    return {
      emoji,
      label: rawLabel,
    };
  }

  function normalizeLabel(unit) {
    if (unit.text) {
      return unit.text.toUpperCase();
    }
    if (unit.id && unit.id.startsWith('FS-')) {
      return unit.id.slice(3);
    }
    return (unit.id || 'SIGN').replace(/-/g, ' ');
  }

  function resolveEmoji(unit, label) {
    if (unit.id && UNIT_EMOJI_MAP[unit.id]) {
      return UNIT_EMOJI_MAP[unit.id];
    }
    if (unit.id && unit.id.startsWith('FS-')) {
      const letter = unit.id.slice(3).toUpperCase();
      return FINGERSPELL_EMOJI_MAP[letter] || '🤟';
    }
    if (unit.id && unit.id.startsWith('NUM-')) {
      return '🔢';
    }
    if (label.includes('QUESTION') || label.includes('?')) {
      return '❓';
    }
    return '🤟';
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

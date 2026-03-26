// SignFlow ASL playback panel
// Uses validated clip assets when available and readable sign cards when a clip is missing.

const SignPlayer = (() => {
  'use strict';

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

  function mount(refs) {
    state.queue = [];
    stopCurrentPlayback();
    state.lastCompletedManifest = null;
    state.refs = refs;
    state.mounted = true;
    updateStatus('Waiting for ASL plan');
    updateQueue([]);
    updateReplayButton();
  }

  function enqueueManifest(manifest) {
    if (!manifest || !Array.isArray(manifest.units) || !manifest.units.length) {
      return;
    }

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
  }

  function updateStatus(message) {
    if (state.refs && state.refs.status) {
      state.refs.status.textContent = message;
    }
  }

  function updateQueue(units) {
    if (!state.refs || !state.refs.unitList) return;

    if (!units.length) {
      state.refs.unitList.innerHTML = '<div class="sf-sign-placeholder">ASL clips will appear here for finalized speech.</div>';
      return;
    }

    state.refs.unitList.innerHTML = units.map((unit) => {
      const label = escapeHtml(unit.text || unit.id.replace(/^FS-/, '').replace(/-/g, ' '));
      return `<div class="sf-sign-chip">${label}</div>`;
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
    updateStatus(`${manifest.priority === 'urgent' ? 'Urgent' : 'Playing'} ASL for: ${manifest.text}`);
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

      if (state.refs && state.refs.label) {
        state.refs.label.textContent = unit.text || unit.id.replace(/^FS-/, '').replace(/-/g, ' ');
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
    state.refs.fallbackCard.textContent = unit.text || unit.id.replace(/^FS-/, '').replace(/-/g, ' ');
    state.refs.fallbackCard.style.display = 'flex';
    if (state.refs.video) {
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
      state.refs.fallbackCard.textContent = '';
    }

    state.currentManifest = null;
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

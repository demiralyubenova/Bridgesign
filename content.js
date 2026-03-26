// SignFlow Content Script
// Injected into Google Meet pages — manages overlay UI, speech recognition, and ASL recognition

(function () {
  'use strict';

  // Prevent double injection
  if (document.getElementById('signflow-root')) return;

  // ==================== STATE ====================
  const state = {
    role: null,         // 'signer' | 'speaker'
    connected: false,
    roomId: null,
    isListening: false,
    isRecognizing: false,
    captions: [],       // { source: 'speech'|'sign', text: string, partial: boolean, timestamp: number }
    maxCaptions: 8,
    minimized: false,
  };

  // ==================== BACKGROUND PORT ====================
  const port = chrome.runtime.connect({ name: 'signflow' });

  port.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'STATE_UPDATE':
        state.connected = msg.data.connected;
        state.roomId = msg.data.roomId;
        updateStatusUI();
        break;
      case 'REMOTE_CAPTION':
        addCaption(msg.data.source, msg.data.text, false);
        break;
      case 'PEER_JOINED':
        showNotification(`Peer joined as ${msg.data.role}`);
        break;
      case 'PEER_LEFT':
        showNotification('Peer disconnected');
        break;
    }
  });

  // ==================== ROOM ID FROM URL ====================
  function getRoomId() {
    const match = window.location.pathname.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
    return match ? match[1] : window.location.pathname.replace(/\//g, '-').slice(1);
  }

  // ==================== UI INJECTION ====================
  function injectUI() {
    // Role selector
    showRoleSelector();
  }

  function showRoleSelector() {
    const existing = document.getElementById('signflow-role-selector');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'signflow-role-selector';
    overlay.className = 'sf-role-selector';
    overlay.innerHTML = `
      <div class="sf-role-card">
        <div class="sf-role-title">Welcome to SignFlow</div>
        <div class="sf-role-subtitle">How will you communicate in this call?</div>
        <div class="sf-role-options">
          <div class="sf-role-option" data-role="signer">
            <div class="sf-role-icon">🤟</div>
            <div class="sf-role-label">I Sign ASL</div>
            <div class="sf-role-desc">Your ASL fingerspelling will be translated to text for others</div>
          </div>
          <div class="sf-role-option" data-role="speaker">
            <div class="sf-role-icon">🗣️</div>
            <div class="sf-role-label">I Speak English</div>
            <div class="sf-role-desc">Your speech will be captioned for sign language users</div>
          </div>
        </div>
      </div>
    `;

    overlay.querySelectorAll('.sf-role-option').forEach((opt) => {
      opt.addEventListener('click', () => {
        const role = opt.dataset.role;
        selectRole(role);
        overlay.remove();
      });
    });

    document.body.appendChild(overlay);
  }

  function selectRole(role) {
    state.role = role;
    chrome.storage.local.set({ signflowRole: role });

    // Join room
    const roomId = getRoomId();
    port.postMessage({ type: 'JOIN_ROOM', roomId, role });

    // Create caption overlay
    createCaptionOverlay();

    // Start appropriate recognition
    if (role === 'speaker') {
      startSpeechRecognition();
    } else if (role === 'signer') {
      startASLRecognition();
    }
  }

  function createCaptionOverlay() {
    const root = document.createElement('div');
    root.id = 'signflow-root';
    root.innerHTML = `
      <div class="sf-caption-bar" id="sf-caption-bar">
        <div class="sf-header">
          <div class="sf-brand">
            <div class="sf-logo">SF</div>
            <span class="sf-brand-name">SignFlow</span>
          </div>
          <div class="sf-status">
            <div class="sf-status-dot" id="sf-status-dot"></div>
            <span class="sf-status-text" id="sf-status-text">Connecting...</span>
          </div>
          <div class="sf-controls">
            <button class="sf-btn" id="sf-btn-role" title="Switch role">
              ${state.role === 'signer' ? '🤟' : '🗣️'} ${state.role === 'signer' ? 'Signer' : 'Speaker'}
            </button>
            <button class="sf-btn" id="sf-btn-minimize" title="Minimize">─</button>
          </div>
        </div>
        <div class="sf-captions" id="sf-captions">
          <div class="sf-caption-line">
            <span class="sf-caption-text empty">Waiting for conversation to start...</span>
          </div>
        </div>
        <div class="sf-pip-container" id="sf-pip-container" style="display:none;">
          <canvas id="sf-pip-canvas" class="sf-pip-canvas" width="320" height="240"></canvas>
          <div class="sf-pip-label" id="sf-pip-label">-</div>
        </div>
      </div>
    `;

    document.body.appendChild(root);

    // Minimize button
    document.getElementById('sf-btn-minimize').addEventListener('click', () => {
      state.minimized = !state.minimized;
      const bar = document.getElementById('sf-caption-bar');
      bar.classList.toggle('minimized', state.minimized);
      document.getElementById('sf-btn-minimize').textContent = state.minimized ? '□' : '─';
    });

    // Role switch button
    document.getElementById('sf-btn-role').addEventListener('click', () => {
      // Stop current recognition
      if (state.role === 'speaker') {
        stopSpeechRecognition();
      } else {
        stopASLRecognition();
      }
      // Show role selector again
      showRoleSelector();
    });

    updateStatusUI();
  }

  function updateStatusUI() {
    const dot = document.getElementById('sf-status-dot');
    const text = document.getElementById('sf-status-text');
    if (!dot || !text) return;

    if (state.connected) {
      dot.className = 'sf-status-dot connected';
      text.textContent = `Room: ${state.roomId || 'unknown'}`;
    } else {
      dot.className = 'sf-status-dot';
      text.textContent = 'Connecting...';
    }
  }

  function showNotification(message) {
    const captionsEl = document.getElementById('sf-captions');
    if (!captionsEl) return;

    const line = document.createElement('div');
    line.className = 'sf-caption-line';
    line.innerHTML = `<span class="sf-caption-text empty">ℹ️ ${message}</span>`;
    captionsEl.appendChild(line);
    captionsEl.scrollTop = captionsEl.scrollHeight;

    setTimeout(() => line.remove(), 5000);
  }

  // ==================== CAPTIONS ====================
  function addCaption(source, text, partial = false) {
    if (!text || !text.trim()) return;

    const captionsEl = document.getElementById('sf-captions');
    if (!captionsEl) return;

    // Clear empty state
    const emptyEl = captionsEl.querySelector('.sf-caption-text.empty');
    if (emptyEl) emptyEl.parentElement.remove();

    // If partial, update last caption of same source
    if (partial) {
      const lastLine = captionsEl.querySelector(`.sf-caption-line[data-source="${source}"][data-partial="true"]`);
      if (lastLine) {
        lastLine.querySelector('.sf-caption-text').textContent = text;
        captionsEl.scrollTop = captionsEl.scrollHeight;
        return;
      }
    } else {
      // Remove partial of same source
      const partialLine = captionsEl.querySelector(`.sf-caption-line[data-source="${source}"][data-partial="true"]`);
      if (partialLine) partialLine.remove();
    }

    const line = document.createElement('div');
    line.className = 'sf-caption-line';
    line.dataset.source = source;
    line.dataset.partial = partial ? 'true' : 'false';
    line.innerHTML = `
      <span class="sf-caption-source ${source}">${source === 'speech' ? 'SPEECH' : 'ASL'}</span>
      <span class="sf-caption-text ${partial ? 'partial' : ''}">${escapeHtml(text)}</span>
    `;

    captionsEl.appendChild(line);
    captionsEl.scrollTop = captionsEl.scrollHeight;

    // Limit caption count
    const lines = captionsEl.querySelectorAll('.sf-caption-line');
    if (lines.length > state.maxCaptions) {
      lines[0].remove();
    }

    // Send to peers (only local captions)
    if (!partial || text.length % 5 === 0) {
      port.postMessage({
        type: 'CAPTION',
        data: { source, text, partial },
      });
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ==================== SPEECH RECOGNITION ====================
  let speechRecognition = null;

  function startSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      showNotification('Speech recognition not supported in this browser');
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechRecognition = new SpeechRecognition();
    speechRecognition.continuous = true;
    speechRecognition.interimResults = true;
    speechRecognition.lang = 'en-US';

    speechRecognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) {
        addCaption('speech', finalTranscript, false);
      } else if (interimTranscript) {
        addCaption('speech', interimTranscript, true);
      }
    };

    speechRecognition.onerror = (event) => {
      console.error('[SignFlow] Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        showNotification('Microphone access denied. Please enable it.');
      }
      // Auto-restart on non-fatal errors
      if (event.error !== 'not-allowed' && event.error !== 'service-not-allowed') {
        setTimeout(() => {
          if (state.role === 'speaker') startSpeechRecognition();
        }, 1000);
      }
    };

    speechRecognition.onend = () => {
      // Auto-restart if still in speaker role
      if (state.role === 'speaker') {
        setTimeout(() => startSpeechRecognition(), 500);
      }
    };

    try {
      speechRecognition.start();
      state.isListening = true;
      showNotification('Speech recognition started');
    } catch (e) {
      console.error('[SignFlow] Failed to start speech recognition:', e);
    }
  }

  function stopSpeechRecognition() {
    if (speechRecognition) {
      speechRecognition.onend = null; // Prevent auto-restart
      speechRecognition.stop();
      speechRecognition = null;
      state.isListening = false;
    }
  }

  // ==================== ASL RECOGNITION ====================
  function startASLRecognition() {
    showNotification('Starting ASL fingerspelling recognition... (webcam required)');

    if (!window.ASLRecognition) {
      showNotification('❌ ASL recognition module not loaded');
      return;
    }

    window.ASLRecognition.start((text, partial) => {
      addCaption('sign', text, partial);
    }).then((success) => {
      if (success) {
        showNotification('✅ ASL fingerspelling active — hold each letter steady for about a second');
      } else {
        showNotification('❌ Failed to start ASL recognition. Check camera permissions.');
      }
    });
  }

  function stopASLRecognition() {
    if (window.ASLRecognition) {
      window.ASLRecognition.stop();
    }
  }

  // ==================== INIT ====================
  function init() {
    // Wait for Meet to fully load
    const checkMeetReady = setInterval(() => {
      // Look for Meet's main container (the call UI)
      const meetContainer = document.querySelector('[data-meeting-title]') ||
                            document.querySelector('[data-call-id]') ||
                            document.querySelector('div[jscontroller]');
      if (meetContainer || document.querySelectorAll('video').length > 0) {
        clearInterval(checkMeetReady);
        setTimeout(() => injectUI(), 1000);
      }
    }, 2000);

    // Failsafe: inject after 10 seconds regardless
    setTimeout(() => {
      clearInterval(checkMeetReady);
      if (!document.getElementById('signflow-root') && !document.getElementById('signflow-role-selector')) {
        injectUI();
      }
    }, 10000);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

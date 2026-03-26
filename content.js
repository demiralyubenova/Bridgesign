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
    transcript: [],     // All finalized captions for download
    settings: {
      fontSize: '16px',
      opacity: 0.85,
      textColor: '#ffffff',
    }
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
    
    // Load saved position
    chrome.storage.local.get(['overlayPos'], (result) => {
      if (result.overlayPos) {
        root.style.top = result.overlayPos.top;
        root.style.left = result.overlayPos.left;
        root.style.bottom = 'auto';
        root.style.transform = 'none';
      }
    });

    root.innerHTML = `
      <div class="sf-caption-bar" id="sf-caption-bar">
        <div class="sf-header">
          <div class="sf-header-left">
            <div class="sf-brand" id="sf-drag-handle" title="Drag to move">
              <div class="sf-logo">SF</div>
              <span class="sf-brand-name">SignFlow</span>
            </div>
          </div>
          <div class="sf-status" id="sf-status-box">
            <div class="sf-status-dot" id="sf-status-dot"></div>
            <span class="sf-status-text" id="sf-status-text">Connecting...</span>
          </div>
          <div class="sf-header-right">
            <div class="sf-controls">
              <button class="sf-btn" id="sf-btn-transcript" title="Download Transcript">📥</button>
              <button class="sf-btn" id="sf-btn-settings" title="Settings">⚙️</button>
              <button class="sf-btn" id="sf-btn-role" title="Switch role">
                ${state.role === 'signer' ? '🤟' : '🗣️'} ${state.role === 'signer' ? 'Signer' : 'Speaker'}
              </button>
              <button class="sf-btn" id="sf-btn-minimize" title="Minimize">─</button>
            </div>
          </div>
        </div>
        <div class="sf-settings-panel" id="sf-settings-panel">
          <div class="sf-settings-section">
            <div class="sf-settings-label">Text Size</div>
            <div class="sf-size-buttons">
              <button class="sf-size-btn ${state.settings.fontSize === '14px' ? 'active' : ''}" data-size="14px">S</button>
              <button class="sf-size-btn ${state.settings.fontSize === '16px' ? 'active' : ''}" data-size="16px">M</button>
              <button class="sf-size-btn ${state.settings.fontSize === '20px' ? 'active' : ''}" data-size="20px">L</button>
            </div>
          </div>
          <div class="sf-settings-section">
            <div class="sf-settings-label">Caption Color</div>
            <div class="sf-color-presets">
              <button class="sf-color-btn ${state.settings.textColor === '#ffffff' ? 'active' : ''}" data-color="#ffffff" style="background: #ffffff;"></button>
              <button class="sf-color-btn ${state.settings.textColor === '#fde047' ? 'active' : ''}" data-color="#fde047" style="background: #fde047;"></button>
              <button class="sf-color-btn ${state.settings.textColor === '#22d3ee' ? 'active' : ''}" data-color="#22d3ee" style="background: #22d3ee;"></button>
              <button class="sf-color-btn ${state.settings.textColor === '#4ade80' ? 'active' : ''}" data-color="#4ade80" style="background: #4ade80;"></button>
            </div>
          </div>
          <div class="sf-settings-section">
            <div class="sf-settings-label">Background Opacity</div>
            <input type="range" class="sf-slider" id="sf-opacity-slider" min="0" max="1" step="0.05" value="${state.settings.opacity}">
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

    // Initialize dragging
    const handle = document.getElementById('sf-drag-handle');
    initDraggable(root, handle);

    // Minimize button
    document.getElementById('sf-btn-minimize').addEventListener('click', () => {
      state.minimized = !state.minimized;
      const bar = document.getElementById('sf-caption-bar');
      bar.classList.toggle('minimized', state.minimized);
      document.getElementById('sf-btn-minimize').textContent = state.minimized ? '□' : '─';
    });

    // Download transcript button
    document.getElementById('sf-btn-transcript').addEventListener('click', downloadTranscript);

    // Settings Toggle
    document.getElementById('sf-btn-settings').addEventListener('click', () => {
      document.getElementById('sf-settings-panel').classList.toggle('active');
    });

    // Font Size Buttons
    document.querySelectorAll('.sf-size-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const size = btn.dataset.size;
        updateSettings({ fontSize: size });
        document.querySelectorAll('.sf-size-btn').forEach(b => b.classList.toggle('active', b === btn));
      });
    });

    // Color buttons
    document.querySelectorAll('.sf-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        updateSettings({ textColor: color });
        document.querySelectorAll('.sf-color-btn').forEach(b => b.classList.toggle('active', b === btn));
      });
    });

    // Opacity Slider
    document.getElementById('sf-opacity-slider').addEventListener('input', (e) => {
      updateSettings({ opacity: e.target.value });
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

    // Load and Apply Initial Settings
    chrome.storage.local.get(['sfSettings'], (result) => {
      if (result.sfSettings) {
        updateSettings(result.sfSettings, false);
        // Sync UI
        document.getElementById('sf-opacity-slider').value = state.settings.opacity;
        document.querySelectorAll('.sf-size-btn').forEach(b => 
          b.classList.toggle('active', b.dataset.size === state.settings.fontSize)
        );
        document.querySelectorAll('.sf-color-btn').forEach(b => 
          b.classList.toggle('active', b.dataset.color === state.settings.textColor)
        );
      }
    });

    updateStatusUI();
  }

  function updateSettings(newSettings, save = true) {
    state.settings = { ...state.settings, ...newSettings };
    
    // Apply to CSS Variables
    const root = document.getElementById('signflow-root');
    if (root) {
      root.style.setProperty('--sf-font-size', state.settings.fontSize);
      root.style.setProperty('--sf-bg-opacity', state.settings.opacity);
      root.style.setProperty('--sf-text-color', state.settings.textColor);
    }

    if (save) {
      chrome.storage.local.set({ sfSettings: state.settings });
    }
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

  function initDraggable(el, handle) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    handle.onmousedown = dragMouseDown;

    function dragMouseDown(e) {
      e = e || window.event;
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    }

    function elementDrag(e) {
      e = e || window.event;
      e.preventDefault();
      pos1 = pos3 - e.clientX;
      pos2 = pos4 - e.clientY;
      pos3 = e.clientX;
      pos4 = e.clientY;
      
      el.style.top = (el.offsetTop - pos2) + "px";
      el.style.left = (el.offsetLeft - pos1) + "px";
      el.style.bottom = 'auto';
      el.style.transform = 'none';
      el.style.margin = '0';
    }

    function closeDragElement() {
      document.onmouseup = null;
      document.onmousemove = null;
      
      chrome.storage.local.set({
        overlayPos: {
          top: el.style.top,
          left: el.style.left
        }
      });
    }
  }

  function showNotification(message) {
    let container = document.getElementById('sf-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'sf-toast-container';
      container.className = 'sf-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'sf-toast';
    toast.innerHTML = `<span class="sf-toast-text">${escapeHtml(message)}</span>`;
    
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('sf-toast-fadeout');
      setTimeout(() => toast.remove(), 300);
    }, 4700);
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

    // Store in internal transcript array (final results only)
    if (!partial) {
      const now = new Date();
      const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
      state.transcript.push({
        timestamp: timeStr,
        source: source === 'speech' ? 'Speech' : 'ASL',
        text: text.trim()
      });
    }
  }

  function downloadTranscript() {
    if (state.transcript.length === 0) {
      showNotification('ℹ️ No captions to download yet');
      return;
    }

    const content = state.transcript
      .map(line => `[${line.timestamp}] ${line.source}: ${line.text}`)
      .join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SignFlow_Transcript_${getRoomId()}_${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showNotification('✅ Transcript downloaded');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ==================== SPEECH RECOGNITION ====================
  let speechRecognition = null;

  function startSpeechRecognition(isAutoRestart = false) {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      if (!isAutoRestart) showNotification('❌ Speech recognition not supported in this browser');
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
        if (!isAutoRestart) showNotification('❌ Microphone access denied. Please enable it.');
      }
      // Auto-restart on non-fatal errors
      if (event.error !== 'not-allowed' && event.error !== 'service-not-allowed') {
        setTimeout(() => {
          if (state.role === 'speaker') startSpeechRecognition(true);
        }, 1000);
      }
    };

    speechRecognition.onend = () => {
      // Auto-restart if still in speaker role
      if (state.role === 'speaker') {
        setTimeout(() => startSpeechRecognition(true), 500);
      }
    };

    try {
      speechRecognition.start();
      state.isListening = true;
      if (!isAutoRestart) {
        showNotification('✅ Speech recognition active');
      }
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
    }).then((result) => {
      if (result === true) {
        showNotification('✅ ASL fingerspelling active — hold each letter steady for about a second');
      } else {
        const errorMsg = typeof result === 'string' ? result : 'Check camera permissions.';
        showNotification(`❌ Failed to start ASL recognition. ${errorMsg}`);
      }
    });
  }

  function stopASLRecognition() {
    if (window.ASLRecognition) {
      window.ASLRecognition.stop();
    }
  }

  // ==================== INIT ====================
  function isMeetingUrl() {
    return /\/[a-zA-Z0-9]{3}-[a-zA-Z0-9]{4}-[a-zA-Z0-9]{3}/.test(window.location.pathname);
  }

  function checkAndInject() {
    const isMeeting = isMeetingUrl();
    const sfRoot = document.getElementById('signflow-root');
    const sfSelector = document.getElementById('signflow-role-selector');
    const hasUI = !!(sfRoot || sfSelector);

    if (!isMeeting) {
      if (hasUI) {
        if (sfRoot) sfRoot.remove();
        if (sfSelector) sfSelector.remove();
      }
      return;
    }

    if (hasUI) return;

    const meetContainer = document.querySelector('[data-meeting-title]') ||
                          document.querySelector('[data-call-id]') ||
                          document.querySelector('div[jscontroller]');
    if (meetContainer || document.getElementsByTagName('video').length > 0) {
      injectUI();
    }
  }

  function init() {
    checkAndInject();

    const observer = new MutationObserver(() => {
      checkAndInject();
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

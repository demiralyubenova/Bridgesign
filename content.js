// BridgeSign Content Script
// Definitive Modern Dashboard Integration (VoiceToolbar)

(function () {
  'use strict';

  if (document.getElementById('bridgesign-root')) return;

  // ==================== STATE ====================
  const state = {
    role: null,         // 'signer' | 'speaker'
    connected: false,
    roomId: null,
    isListening: false,
    transcripts: [],     // { speaker, text, partial }
    fullTranscript: [], // For download
    minimized: false,
    settings: {
      fontSize: '14px',
      opacity: 0.9,
      textColor: '#e5e5e5',
    },
    toolbar: null,
    autoInjectDisabled: false,
    recentLocalSpeech: [],
  };

  // ==================== COMPONENT: VoiceToolbar ====================
  class VoiceToolbar {
    constructor({ container, sessionId = '...', userName = 'SF' } = {}) {
      this.container = container;
      this.sessionId = sessionId;
      this.userName = userName;
      this.listening = false;
      this._waveFrame = null;
    }

    mount() {
      this._render();
      this._startListeningAnimation();
    }

    destroy() {
      if (this._waveFrame) {
        cancelAnimationFrame(this._waveFrame);
        this._waveFrame = null;
      }
    }

    addTranscript({ speaker, text, partial = false }) {
      if (partial) {
        const last = state.transcripts[state.transcripts.length - 1];
        if (last && last.speaker === speaker && last.partial) {
          last.text = text;
        } else {
          state.transcripts.push({ speaker, text, partial: true });
        }
      } else {
        const lastFinal = state.transcripts[state.transcripts.length - 1];
        if (lastFinal && !lastFinal.partial && lastFinal.speaker === speaker && lastFinal.text === text) {
          return;
        }

        // Remove existing partial of same speaker if exists
        state.transcripts = state.transcripts.filter(t => !(t.speaker === speaker && t.partial));
        state.transcripts.push({ speaker, text, partial: false });
        
        // Store for download
        const now = new Date();
        const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
        const lastSaved = state.fullTranscript[state.fullTranscript.length - 1];
        if (!lastSaved || lastSaved.speaker !== speaker || lastSaved.text !== text) {
          state.fullTranscript.push({ timestamp: timeStr, speaker, text });
        }
      }

      if (state.transcripts.length > 6) state.transcripts.shift();
      this._renderTranscripts();
    }

    setListening(active) {
      this.listening = active;
      const row = this.container.querySelector('.vt-listening-row');
      if (row) row.style.display = active ? 'flex' : 'none';
    }

    setSessionId(id) {
      this.sessionId = id || '...';
      const pill = this.container.querySelector('.vt-session-label');
      if (pill) pill.textContent = this.sessionId.toLowerCase();
      
      const dot = this.container.querySelector('.vt-dot');
      if (dot) {
        dot.className = `vt-dot ${state.connected ? 'vt-dot--live' : 'vt-dot--idle'}`;
      }
    }

    _render() {
      this.container.innerHTML = `
        <div class="vt-section">
          <label class="vt-section-label">TOOLBAR</label>
          <div class="vt-toolbar vt-panel" id="sf-toolbar">
            <div class="vt-avatar" id="sf-drag-handle">SF</div>

            <div class="vt-session-pill">
              <div class="vt-dot ${state.connected ? 'vt-dot--live' : 'vt-dot--idle'}"></div>
              <span class="vt-session-label">${this.sessionId}</span>
            </div>

            <div class="vt-spacer"></div>

            <button class="vt-icon-btn" data-action="transcript" title="Download Transcript">
              ${this._iconDownload()}
            </button>

            <button class="vt-icon-btn" data-action="settings" title="Settings">
              ${this._iconSettings()}
            </button>

            <button class="vt-icon-btn" data-action="role" title="Switch Role">
              ${this._iconSwitch()}
            </button>

            <div class="vt-divider"></div>

            <button class="vt-icon-btn vt-icon-btn--danger" data-action="leave" title="Leave">
              ${this._iconLeave()}
            </button>

            <!-- Settings Panel Injection -->
            <div class="sf-settings-panel" id="sf-settings-panel">
              <div class="sf-settings-section">
                <div class="sf-settings-label">Text Size</div>
                <div class="sf-size-buttons">
                  <button class="sf-size-btn ${state.settings.fontSize === '12px' ? 'active' : ''}" data-size="12px">S</button>
                  <button class="sf-size-btn ${state.settings.fontSize === '14px' ? 'active' : ''}" data-size="14px">M</button>
                  <button class="sf-size-btn ${state.settings.fontSize === '18px' ? 'active' : ''}" data-size="18px">L</button>
                </div>
              </div>

              <div class="sf-settings-section">
                <div class="sf-settings-label">Caption Color</div>
                <div class="sf-color-presets">
                  <button class="sf-color-btn ${state.settings.textColor === '#e5e5e5' ? 'active' : ''}" data-color="#e5e5e5" style="background:#e5e5e5"></button>
                  <button class="sf-color-btn ${state.settings.textColor === '#22d3ee' ? 'active' : ''}" data-color="#22d3ee" style="background:#22d3ee"></button>
                  <button class="sf-color-btn ${state.settings.textColor === '#4ade80' ? 'active' : ''}" data-color="#4ade80" style="background:#4ade80"></button>
                  <button class="sf-color-btn ${state.settings.textColor === '#facc15' ? 'active' : ''}" data-color="#facc15" style="background:#facc15"></button>
                  <button class="sf-color-btn ${state.settings.textColor === '#f472b6' ? 'active' : ''}" data-color="#f472b6" style="background:#f472b6"></button>
                </div>
              </div>

              <div class="sf-settings-section">
                <div class="sf-settings-label">Ghost Opacity</div>
                <input type="range" class="sf-slider" id="sf-opacity-slider" min="0.1" max="1" step="0.05" value="${state.settings.opacity}">
              </div>
            </div>
          </div>
        </div>

        <div class="vt-section" id="sf-transcript-section">
          <label class="vt-section-label">TRANSCRIPT</label>
          <div class="vt-transcript-wrap vt-panel">
            <div class="vt-transcript-list"></div>
            <div class="vt-listening-row" style="display: ${this.listening ? 'flex' : 'none'}">
              <div class="vt-speaker-tag">You</div>
              <div class="vt-wave-wrap">
                <div class="vt-wave">
                  <span class="vt-bar"></span>
                  <span class="vt-bar"></span>
                  <span class="vt-bar"></span>
                  <span class="vt-bar"></span>
                  <span class="vt-bar"></span>
                </div>
                <span class="vt-listening-label">listening…</span>
              </div>
            </div>
          </div>
        </div>

        <div class="vt-section" id="sf-sign-section" style="display:${state.role === 'signer' ? '' : 'none'}">
          <div class="sf-sign-section-header">
            <label class="vt-section-label">ASL Playback</label>
            <button class="sf-sign-replay" id="sf-replay-sign" type="button">Replay</button>
          </div>
          <div class="sf-sign-panel vt-panel">
            <div class="sf-sign-stage">
              <video class="sf-sign-video" id="sf-sign-video" playsinline muted></video>
              <div class="sf-sign-fallback-card" id="sf-sign-fallback-card" style="display:none;"></div>
            </div>
            <div class="sf-sign-meta">
              <div class="sf-sign-status" id="sf-sign-status">Waiting for ASL plan</div>
              <div class="sf-sign-current" id="sf-sign-current">-</div>
            </div>
            <div class="sf-sign-unit-list" id="sf-sign-unit-list"></div>
          </div>
        </div>
      `;

      this._bindEvents();
      this._renderTranscripts();
    }

    _renderTranscripts() {
      const list = this.container.querySelector('.vt-transcript-list');
      if (!list) return;
      list.innerHTML = state.transcripts.map((t) => `
        <div class="vt-transcript-row">
          <div class="vt-speaker-tag">${t.speaker}</div>
          <div class="vt-transcript-text ${t.partial ? 'vt-transcript-text--muted' : ''}">
            ${escapeHtml(t.text)}
          </div>
        </div>
      `).join('');
      list.scrollTop = list.scrollHeight;
    }

    _bindEvents() {
      this.container.querySelectorAll('.vt-icon-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          if (action === 'settings') {
            document.getElementById('sf-settings-panel').classList.toggle('active');
          } else if (action === 'transcript') {
            downloadTranscript();
          } else if (action === 'role') {
            switchRole();
          } else if (action === 'leave') {
            leaveMeetSession();
          }
        });
      });

      // Settings events
      this.container.querySelectorAll('.sf-size-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          updateSettings({ fontSize: btn.dataset.size });
          this.container.querySelectorAll('.sf-size-btn').forEach(b => b.classList.toggle('active', b === btn));
        });
      });

      this.container.querySelectorAll('.sf-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          updateSettings({ textColor: btn.dataset.color });
          this.container.querySelectorAll('.sf-color-btn').forEach(b => b.classList.toggle('active', b === btn));
        });
      });

      this.container.querySelector('#sf-opacity-slider').addEventListener('input', (e) => {
        updateSettings({ opacity: e.target.value });
      });

      this.container.querySelector('#sf-replay-sign').addEventListener('click', () => {
        if (window.SignPlayer) {
          window.SignPlayer.replayLast();
        }
      });
    }

    _startListeningAnimation() {
      const bars = this.container.querySelectorAll('.vt-bar');
      if (bars.length === 0) return;
      const heights = [4, 8, 12, 8, 5];
      let tick = 0;

      const animate = () => {
        tick++;
        bars.forEach((bar, i) => {
          const phase = (tick * 0.04 + i * 0.4);
          const h = heights[i] + Math.sin(phase) * heights[i] * 0.6;
          bar.style.height = Math.max(2, h) + 'px';
        });
        this._waveFrame = requestAnimationFrame(animate);
      };
      animate();
    }

    _iconDownload() {
      return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 10v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3"/><polyline points="5 7 8 10 11 7"/><line x1="8" y1="2" x2="8" y2="10"/></svg>`;
    }
    _iconSettings() {
      return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M3.8 12.2l1.1-1.1M11.1 4.9l1.1-1.1"/></svg>`;
    }
    _iconSwitch() {
      return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4H2"/><path d="M4 2 2 4l2 2"/><path d="M2 12h12"/><path d="M12 10l2 2-2 2"/></svg>`;
    }
    _iconLeave() {
      return `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/><polyline points="10 11 14 8 10 5"/><line x1="14" y1="8" x2="6" y2="8"/></svg>`;
    }
  }

  // ==================== RECOGNITION CALLS ====================
  const port = chrome.runtime.connect({ name: 'bridgesign' });

  function sendPortMessage(message) {
    try {
      port.postMessage(message);
      return true;
    } catch (error) {
      console.warn('[BridgeSign] Failed to send message to background:', error);
      return false;
    }
  }

  port.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'STATE_UPDATE':
        state.connected = msg.data.connected;
        state.roomId = msg.data.roomId;
        if (state.toolbar) state.toolbar.setSessionId(state.roomId);
        break;
      case 'REMOTE_CAPTION':
        if (state.toolbar) state.toolbar.addTranscript({ 
          speaker: msg.data.source === 'speech' ? 'Voice' : 'Sign', 
          text: msg.data.text,
          partial: msg.data.partial 
        });
        break;
      case 'REMOTE_SIGN_PLAN':
        if (state.role === 'signer' && window.SignPlayer) {
          window.SignPlayer.enqueueManifest(msg.data.signPlan);
        }
        break;
      case 'LOCAL_SIGN_PLAN':
        if (state.role === 'signer' && window.SignPlayer) {
          window.SignPlayer.enqueueManifest(msg.data.signPlan);
        }
        break;
      case 'PEER_JOINED': showNotification(`Peer joined as ${msg.data.role}`); break;
      case 'PEER_LEFT': showNotification('Peer disconnected'); break;
    }
  });

  // ==================== CORE FUNCTIONS ====================
  function injectUI() {
    showRoleSelector();
  }

  function normalizeTranscriptText(text) {
    return (text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function rememberLocalSpeech(text) {
    const normalized = normalizeTranscriptText(text);
    if (!normalized) return;

    const cutoff = Date.now() - 5000;
    state.recentLocalSpeech = state.recentLocalSpeech.filter((entry) => entry.ts >= cutoff);
    state.recentLocalSpeech.push({ text: normalized, ts: Date.now() });
  }

  function isLikelyOwnMeetCaption(text) {
    const normalized = normalizeTranscriptText(text);
    if (!normalized) return false;

    const cutoff = Date.now() - 5000;
    state.recentLocalSpeech = state.recentLocalSpeech.filter((entry) => entry.ts >= cutoff);
    return state.recentLocalSpeech.some((entry) => entry.text === normalized);
  }

  function startMeetCaptionCapture() {
    if (!window.__BridgeSignCaptionScraper) return;

    window.__BridgeSignCaptionScraper.start((cap) => {
      if (!cap || !cap.text) return;
      if (state.role === 'speaker' && isLikelyOwnMeetCaption(cap.text)) return;

      if (state.toolbar) {
        state.toolbar.addTranscript({
          speaker: cap.speaker || 'Them',
          text: cap.text,
          partial: false,
        });
      }
    });
  }

  // ==================== ONBOARDING TUTORIAL ====================
  const ONBOARDING_SLIDES = [
    {
      icon: '🤟',
      title: 'Welcome to BridgeSign',
      body: 'BridgeSign bridges the gap between hearing speakers and ASL signers during Google Meet calls — no extensions needed on the other side.',
    },
    {
      icon: '🗣️',
      title: 'Speaker Role',
      body: 'Choose this if you speak aloud. Your speech is converted to live subtitles burned directly into your camera feed so everyone can read what you say — even without the extension.',
    },
    {
      icon: '🤲',
      title: 'ASL Signer Role',
      body: 'Choose this if you communicate through ASL. Your hand signs are recognized by the camera and converted to text subtitles. You will also see an ASL playback panel showing sign translations of what others say.',
    },
    {
      icon: '⚙️',
      title: 'Your Dashboard',
      body: 'After choosing a role, a floating dashboard appears with a live transcript, settings for text size and color, and a download button to save the conversation. You can drag it anywhere on screen.',
    },
  ];

  function showOnboarding(onComplete) {
    const existing = document.getElementById('bridgesign-onboarding');
    if (existing) existing.remove();

    let currentSlide = 0;

    const overlay = document.createElement('div');
    overlay.id = 'bridgesign-onboarding';
    overlay.className = 'vt-role-selector-overlay';

    function renderSlide() {
      const slide = ONBOARDING_SLIDES[currentSlide];
      const isLast = currentSlide === ONBOARDING_SLIDES.length - 1;
      const isFirst = currentSlide === 0;

      overlay.innerHTML = `
        <div class="vt-onboarding-card">
          <div class="vt-onboarding-icon">${slide.icon}</div>
          <h2 class="vt-onboarding-title">${slide.title}</h2>
          <p class="vt-onboarding-body">${slide.body}</p>
          <div class="vt-onboarding-dots">
            ${ONBOARDING_SLIDES.map((_, i) =>
              `<span class="vt-onboarding-dot ${i === currentSlide ? 'active' : ''}"></span>`
            ).join('')}
          </div>
          <div class="vt-onboarding-actions">
            ${isFirst
              ? `<button class="vt-onboarding-skip" id="ob-skip">Skip</button>`
              : `<button class="vt-onboarding-back" id="ob-back">Back</button>`
            }
            <button class="vt-onboarding-next" id="ob-next">${isLast ? 'Get Started' : 'Next'}</button>
          </div>
        </div>
      `;

      overlay.querySelector('#ob-next').addEventListener('click', () => {
        if (isLast) {
          chrome.storage.local.set({ bridgesignOnboarded: true });
          overlay.remove();
          onComplete();
        } else {
          currentSlide++;
          renderSlide();
        }
      });

      if (isFirst) {
        overlay.querySelector('#ob-skip').addEventListener('click', () => {
          chrome.storage.local.set({ bridgesignOnboarded: true });
          overlay.remove();
          onComplete();
        });
      } else {
        overlay.querySelector('#ob-back').addEventListener('click', () => {
          currentSlide--;
          renderSlide();
        });
      }
    }

    renderSlide();
    document.body.appendChild(overlay);
  }

  function showRoleSelector() {
    const existing = document.getElementById('bridgesign-role-selector');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'bridgesign-role-selector';
    overlay.className = 'vt-role-selector-overlay';
    overlay.innerHTML = `
      <div class="vt-role-card">
        <h2 class="vt-role-title">BridgeSign</h2>
        <p class="vt-role-subtitle">Choose your communication mode:</p>
        <div class="vt-role-options">
          <button class="vt-role-btn" data-role="signer">
            <span class="vt-role-icon">🤟</span>
            <span class="vt-role-label">ASL Signer</span>
          </button>
          <button class="vt-role-btn" data-role="speaker">
            <span class="vt-role-icon">🗣️</span>
            <span class="vt-role-label">Speaker</span>
          </button>
        </div>
      </div>
    `;

    overlay.querySelectorAll('.vt-role-btn').forEach(btn => {
      btn.onclick = async (e) => {
        const target = e.currentTarget;
        state.role = target.dataset.role;
        overlay.remove();
        await startSession();
      };
    });
    document.body.appendChild(overlay);
  }

  function injectUI() {
    chrome.storage.local.get('bridgesignOnboarded', (res) => {
      if (res.bridgesignOnboarded) {
        showRoleSelector();
      } else {
        showOnboarding(() => showRoleSelector());
      }
    });
  }

  async function startSession() {
    const root = document.createElement('div');
    root.id = 'bridgesign-root';
    document.body.appendChild(root);

    // If signer, inject PiP window
    if (state.role === 'signer') {
      const existingPip = document.getElementById('sf-pip-container');
      if (existingPip) existingPip.remove();

      const pip = document.createElement('div');
      pip.id = 'sf-pip-container';
      pip.className = 'sf-pip-container';
      pip.style.display = 'block'; // Ensure it starts visible
      pip.innerHTML = `
        <div class="sf-pip-header" id="sf-pip-header">ASL PREVIEW</div>
        <canvas class="sf-pip-canvas" id="sf-pip-canvas"></canvas>
        <div class="sf-pip-label-wrap">
          <span class="sf-pip-label" id="sf-pip-label">-</span>
        </div>
      `;
      document.body.appendChild(pip);
      initDraggable(pip, pip.querySelector('#sf-pip-header'));
    }

    state.toolbar = new VoiceToolbar({ container: root, sessionId: getRoomId() });
    state.toolbar.mount();

    if (state.role === 'signer' && window.SignPlayer) {
      window.SignPlayer.mount({
        section: document.getElementById('sf-sign-section'),
        status: document.getElementById('sf-sign-status'),
        label: document.getElementById('sf-sign-current'),
        unitList: document.getElementById('sf-sign-unit-list'),
        video: document.getElementById('sf-sign-video'),
        fallbackCard: document.getElementById('sf-sign-fallback-card'),
        replayButton: document.getElementById('sf-replay-sign'),
      });
    }

    chrome.storage.local.set({ bridgesignRole: state.role });

    // Init Draggable Dashboard
    initDraggable(root, document.getElementById('sf-drag-handle'));

    // Join room
    sendPortMessage({ type: 'JOIN_ROOM', roomId: getRoomId(), role: state.role });

    // Both roles burn subtitles into the camera feed
    document.dispatchEvent(new CustomEvent('bridgesign-vcam-activate'));

    // Recognition
    stopSpeechRecognition();
    if (state.role === 'speaker') {
      document.dispatchEvent(new CustomEvent('bridgesign-vcam-activate'));
      startSpeechRecognition();
    } else {
      document.dispatchEvent(new CustomEvent('bridgesign-vcam-stop'));
      await startASLRecognition();

      // Start scraping Meet's built-in CC so the signer can read speech
      startMeetCaptionScraping();
    }

    startMeetCaptionCapture();

    // Load settings
    chrome.storage.local.get(['sfSettings', 'overlayPos'], (res) => {
      if (res.sfSettings) updateSettings(res.sfSettings);
      if (res.overlayPos) {
        root.style.top = res.overlayPos.top;
        root.style.left = res.overlayPos.left;
        root.style.bottom = 'auto';
        root.style.transform = 'none';
      }
    });
  }

  function updateSettings(s) {
    state.settings = { ...state.settings, ...s };
    const root = document.getElementById('bridgesign-root');
    if (root) {
      root.style.setProperty('--sf-font-size', state.settings.fontSize);
      root.style.setProperty('--sf-bg-opacity', state.settings.opacity);
      root.style.setProperty('--sf-caption-color', state.settings.textColor);
    }
    chrome.storage.local.set({ sfSettings: state.settings });
  }

  function switchRole() {
    endSession();
    showRoleSelector();
  }

  function stopSessionFeatures() {
    if (state.toolbar) {
      state.toolbar.setListening(false);
    }

    if (state.role === 'speaker') {
      stopSpeechRecognition();
    } else if (state.role === 'signer') {
      stopASLRecognition();
      stopMeetCaptionScraping();
    }

    if (window.__BridgeSignCaptionScraper) window.__BridgeSignCaptionScraper.stop();

    document.dispatchEvent(new CustomEvent('bridgesign-vcam-stop'));

    if (window.SignPlayer) {
      window.SignPlayer.reset();
    }
  }

  function removeInjectedUi() {
    if (state.toolbar) {
      state.toolbar.destroy();
      state.toolbar = null;
    }

    [
      'bridgesign-root',
      'bridgesign-role-selector',
      'sf-pip-container',
      'sf-toast-container',
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  function resetSessionState() {
    state.connected = false;
    state.roomId = null;
    state.role = null;
    state.isListening = false;
    state.transcripts = [];
    state.fullTranscript = [];
    state.recentLocalSpeech = [];
  }

  function endSession({ notifyBackground = true } = {}) {
    if (notifyBackground && (state.connected || state.roomId)) {
      sendPortMessage({ type: 'LEAVE_ROOM' });
    }

    stopSessionFeatures();
    removeInjectedUi();
    resetSessionState();
  }

  function clickNativeLeaveButton() {
    const selectors = [
      'button[aria-label*="Leave call"]',
      'button[aria-label*="leave call"]',
      'button[aria-label*="End call"]',
      'button[aria-label*="hang up"]',
      'button[jsname="CQylAd"]',
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button) {
        button.click();
        return true;
      }
    }

    return false;
  }

  function leaveMeetSession() {
    state.autoInjectDisabled = true;
    endSession();

    const clickedNativeLeave = clickNativeLeaveButton();
    const fallbackDelayMs = clickedNativeLeave ? 700 : 0;

    window.setTimeout(() => {
      if (isMeetRoomPage()) {
        window.location.assign('https://meet.google.com/');
      }
    }, fallbackDelayMs);
  }

  // ==================== RECOGNITION (STUBS) ====================
  // [Keeping existing speech recognition and ASL logic but calling state.toolbar.addTranscript]
  
  let speechRec = null;
  const SPEECH_RECOGNITION_LANG = 'en-US';
  function startSpeechRecognition(auto = false) {
    if (state.role !== 'speaker') return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    speechRec = new SpeechRecognition();
    speechRec.lang = SPEECH_RECOGNITION_LANG;
    speechRec.continuous = true;
    speechRec.interimResults = true;
    speechRec.onresult = (e) => {
      if (isMuted()) return;

      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      if (final) {
        rememberLocalSpeech(final);
        if (state.toolbar) {
          state.toolbar.addTranscript({ speaker: 'You', text: final, partial: false });
        }
        document.dispatchEvent(new CustomEvent('bridgesign-vcam-caption', { detail: { text: final } }));
        sendPortMessage({ type: 'CAPTION', data: { source: 'speech', text: final, partial: false } });
      } else if (interim) {
        rememberLocalSpeech(interim);
        if (state.toolbar) {
          state.toolbar.addTranscript({ speaker: 'You', text: interim, partial: true });
        }
        document.dispatchEvent(new CustomEvent('bridgesign-vcam-caption', { detail: { text: interim } }));
        sendPortMessage({ type: 'CAPTION', data: { source: 'speech', text: interim, partial: true } });
      }
    };
    speechRec.onstart = () => {
      if (state.toolbar) state.toolbar.setListening(true);
    };
    speechRec.onend = () => { if (state.role === 'speaker') speechRec.start(); };
    speechRec.start();
  }
  function stopSpeechRecognition() { if (speechRec) { speechRec.onend = null; speechRec.stop(); } }

  async function startASLRecognition() {
    if (window.ASLRecognition) {
      if (state.toolbar) state.toolbar.setListening(true);
      const result = await window.ASLRecognition.start((text, partial) => {
        if (state.toolbar) {
          state.toolbar.addTranscript({ speaker: 'You', text, partial });
        }
        document.dispatchEvent(new CustomEvent('bridgesign-vcam-caption', { detail: { text } }));
        sendPortMessage({ type: 'CAPTION', data: { source: 'sign', text, partial } });
      });

      if (result !== true) {
        if (state.toolbar) state.toolbar.setListening(false);
        showNotification(`⚠️ Signer Failed: ${result || 'Unknown error'}`);
      }
    } else {
      showNotification('⚠️ ASL Recognition module not loaded');
    }
  }
  function stopASLRecognition() { if (window.ASLRecognition) window.ASLRecognition.stop(); }

  // ==================== SIGNER SPEECH LISTENER ====================
  // Uses the same Web Speech API as the speaker role, but for the signer
  // to hear what others say through their microphone picking up meeting audio.
  let signerSpeechRec = null;

  function startMeetCaptionScraping() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showNotification('⚠️ Speech recognition not supported in this browser');
      return;
    }
    if (signerSpeechRec) stopMeetCaptionScraping();

    signerSpeechRec = new SpeechRecognition();
    signerSpeechRec.lang = SPEECH_RECOGNITION_LANG;
    signerSpeechRec.continuous = true;
    signerSpeechRec.interimResults = true;

    signerSpeechRec.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      if (final) {
        if (state.toolbar) {
          state.toolbar.addTranscript({ speaker: 'Speaker', text: final, partial: false });
        }
        document.dispatchEvent(new CustomEvent('bridgesign-vcam-caption', { detail: { text: final } }));

        const now = new Date();
        const timeStr = `${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
        state.fullTranscript.push({ timestamp: timeStr, speaker: 'Speaker', text: final });
      } else if (interim) {
        if (state.toolbar) {
          state.toolbar.addTranscript({ speaker: 'Speaker', text: interim, partial: true });
        }
        document.dispatchEvent(new CustomEvent('bridgesign-vcam-caption', { detail: { text: interim } }));
      }
    };

    signerSpeechRec.onend = () => {
      // Auto-restart if still in signer role
      if (state.role === 'signer' && signerSpeechRec) {
        try { signerSpeechRec.start(); } catch (_) {}
      }
    };

    signerSpeechRec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[BridgeSign] Signer speech recognition error:', e.error);
      }
    };

    try {
      signerSpeechRec.start();
      showNotification('🎙️ Listening for speaker audio');
    } catch (err) {
      console.error('[BridgeSign] Failed to start signer speech recognition:', err);
    }
  }

  function stopMeetCaptionScraping() {
    if (signerSpeechRec) {
      signerSpeechRec.onend = null;
      signerSpeechRec.stop();
      signerSpeechRec = null;
    }
    if (window.MeetCaptionScraper) window.MeetCaptionScraper.stop();
  }

  // ==================== HELPERS ====================
  function getRoomId() {
    const m = window.location.pathname.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
    return m ? m[1] : 'direct-call';
  }

  function initDraggable(el, handle) {
    let px = 0, py = 0;
    handle.onmousedown = (e) => {
      e.preventDefault();
      px = e.clientX; py = e.clientY;
      document.onmouseup = () => {
        document.onmouseup = null; document.onmousemove = null;
        chrome.storage.local.set({ overlayPos: { top: el.style.top, left: el.style.left } });
      };
      document.onmousemove = (e) => {
        e.preventDefault();
        el.style.top = (el.offsetTop - (py - e.clientY)) + "px";
        el.style.left = (el.offsetLeft - (px - e.clientX)) + "px";
        px = e.clientX; py = e.clientY;
        el.style.bottom = 'auto'; el.style.transform = 'none'; el.style.margin = '0';
      };
    };
  }

  function downloadTranscript() {
    if (state.fullTranscript.length === 0) return showNotification('No transcript yet');
    const blob = new Blob([state.fullTranscript.map(l => `[${l.timestamp}] ${l.speaker}: ${l.text}`).join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `BridgeSign_Transcript_${getRoomId()}.txt`;
    a.click();
    showNotification('✅ Downloaded');
  }

  function isMuted() {
    const micBtn = document.querySelector('button[data-is-muted]');
    if (micBtn) return micBtn.getAttribute('data-is-muted') === 'true';
    const btn = document.querySelector('button[aria-label*="microphone"]');
    if (btn) {
      const label = btn.getAttribute('aria-label').toLowerCase();
      return label.includes('turn on');
    }
    return false;
  }

  function showNotification(msg) {
    let c = document.getElementById('sf-toast-container') || document.createElement('div');
    if (!c.id) { c.id = 'sf-toast-container'; c.className = 'sf-toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div');
    t.className = 'sf-toast';
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
  }

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function isMeetRoomPage() {
    return /\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(window.location.pathname);
  }

  // Init logic
  function check() {
    if (!isMeetRoomPage()) {
      state.autoInjectDisabled = false;
      endSession();
      return;
    }

    if (state.autoInjectDisabled) return;

    if (document.getElementById('bridgesign-root') || document.getElementById('bridgesign-role-selector') || document.getElementById('bridgesign-onboarding')) return;
    if (document.querySelector('video')) injectUI();
  }

  check();
  new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('pagehide', () => endSession(), { capture: true });

})();

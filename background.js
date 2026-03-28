// BridgeSign Background Service Worker
// Manages per-tab relay sessions, sign-planning requests, and the offscreen ASL pipeline.

const DEFAULT_RELAY_URL = 'ws://localhost:3001';
const DEFAULT_PLANNER_URL = 'http://localhost:8001';

let RELAY_SERVER_URL = DEFAULT_RELAY_URL;
let SIGN_PLAN_SERVER_URL = DEFAULT_PLANNER_URL;

const LEGACY_RELAY_URLS = new Set([
  'ws://172.20.10.8:3001',
  'ws://192.168.1.6:3001',
]);
const LEGACY_PLANNER_URLS = new Set([
  'http://172.20.10.8:8001',
]);

function normalizeRelayUrl(url) {
  return LEGACY_RELAY_URLS.has(url) ? DEFAULT_RELAY_URL : url;
}

function normalizePlannerUrl(url) {
  return LEGACY_PLANNER_URLS.has(url) ? DEFAULT_PLANNER_URL : url;
}

chrome.storage.sync.get(
  ['bridgesignServerUrl', 'bridgesignPlannerUrl', 'signflowServerUrl', 'signflowPlannerUrl'],
  (res) => {
    const relayUrl = normalizeRelayUrl(res.bridgesignServerUrl || res.signflowServerUrl || RELAY_SERVER_URL);
    const plannerUrl = normalizePlannerUrl(res.bridgesignPlannerUrl || res.signflowPlannerUrl || SIGN_PLAN_SERVER_URL);

    RELAY_SERVER_URL = relayUrl;
    SIGN_PLAN_SERVER_URL = plannerUrl;

    if (res.bridgesignServerUrl !== relayUrl || res.bridgesignPlannerUrl !== plannerUrl) {
      chrome.storage.sync.set({
        bridgesignServerUrl: relayUrl,
        bridgesignPlannerUrl: plannerUrl,
      });
    }
  }
);

const tabSessions = new Map(); // tabId -> { port, ws, roomId, role, reconnectAttempts, latencyMs, pingInterval, lastError }
const MAX_PENDING_MESSAGES = 50;

function bgLog(message, details) {
  if (details === undefined) {
    console.log(`[BridgeSign][background] ${message}`);
    return;
  }
  console.log(`[BridgeSign][background] ${message}`, details);
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== 'sync') return;

  if (changes.bridgesignServerUrl || changes.signflowServerUrl) {
    const rawRelayUrl = changes.bridgesignServerUrl?.newValue || changes.signflowServerUrl?.newValue || RELAY_SERVER_URL;
    const nextRelayUrl = normalizeRelayUrl(rawRelayUrl);
    if (nextRelayUrl === RELAY_SERVER_URL) return;
    RELAY_SERVER_URL = nextRelayUrl;
    console.log('[BridgeSign] Server URL updated:', RELAY_SERVER_URL);
    for (const session of tabSessions.values()) {
      if (session.ws && session.ws.readyState !== WebSocket.CLOSED) {
        session.ws.close();
      }
    }
  }

  if (changes.bridgesignPlannerUrl || changes.signflowPlannerUrl) {
    const rawPlannerUrl = changes.bridgesignPlannerUrl?.newValue || changes.signflowPlannerUrl?.newValue || SIGN_PLAN_SERVER_URL;
    const nextPlannerUrl = normalizePlannerUrl(rawPlannerUrl);
    if (nextPlannerUrl === SIGN_PLAN_SERVER_URL) return;
    SIGN_PLAN_SERVER_URL = nextPlannerUrl;
    console.log('[BridgeSign] Sign planner URL updated:', SIGN_PLAN_SERVER_URL);
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'bridgesign' || !port.sender.tab) return;

  const tabId = port.sender.tab.id;
  bgLog('Port connected', { tabId, url: port.sender.tab.url });
  const session = {
    port,
    ws: null,
    roomId: null,
    role: null,
    peerCount: 0,
    pendingMessages: [],
    reconnectAttempts: 0,
    latencyMs: 0,
    pingInterval: null,
    lastError: null,
  };

  tabSessions.set(tabId, session);

  port.onMessage.addListener((msg) => {
    bgLog('Port message received', { tabId, type: msg && msg.type, data: msg && msg.data });
    handleContentMessage(tabId, msg);
  });

  port.onDisconnect.addListener(() => {
    bgLog('Port disconnected', { tabId });
    teardownSession(tabId);
  });
});

self.addEventListener('online', () => {
  for (const [tabId, session] of tabSessions.entries()) {
    if (session.roomId && (!session.ws || session.ws.readyState !== WebSocket.OPEN)) {
      session.reconnectAttempts = 0;
      joinRoom(tabId, session.roomId, session.role);
    }
  }
});

function getSession(tabId) {
  return tabSessions.get(tabId) || null;
}

function clearPingInterval(session) {
  if (session && session.pingInterval) {
    clearInterval(session.pingInterval);
    session.pingInterval = null;
  }
}

function teardownSession(tabId) {
  const session = getSession(tabId);
  if (!session) return;

  bgLog('Tearing down session', { tabId, roomId: session.roomId, role: session.role });

  clearPingInterval(session);

  if (session.ws && session.ws.readyState === WebSocket.OPEN) {
    session.ws.close();
  }

  tabSessions.delete(tabId);
}

function handleContentMessage(tabId, msg) {
  const session = getSession(tabId);
  if (!session) return;

  switch (msg.type) {
    case 'JOIN_ROOM':
      joinRoom(tabId, msg.roomId, msg.role);
      break;
    case 'LEAVE_ROOM':
      leaveRoom(tabId);
      break;
    case 'EXTENSION_ERROR':
      session.lastError = msg.message;
      break;
    case 'CAPTION':
      sendCaption(tabId, msg.data);
      break;
    case 'GET_STATE':
      sendToTab(tabId, {
        type: 'STATE_UPDATE',
        data: {
          connected: Boolean(session.ws && session.ws.readyState === WebSocket.OPEN),
          roomId: session.roomId,
        },
      });
      break;
  }
}

function joinRoom(tabId, roomId, role) {
  const session = getSession(tabId);
  if (!session || !roomId) return;

  bgLog('Joining room', { tabId, roomId, role, relayUrl: RELAY_SERVER_URL });

  session.roomId = roomId;
  if (role) session.role = role;
  session.peerCount = 0;
  session.lastError = null;

  if (session.ws && session.ws.readyState === WebSocket.OPEN) {
    bgLog('WebSocket already open, sending JOIN immediately', { tabId, roomId, role: session.role });
    session.ws.send(JSON.stringify({ type: 'JOIN', roomId, role: session.role }));
    sendToTab(tabId, { type: 'STATE_UPDATE', data: { connected: true, roomId } });
    return;
  }

  if (session.ws && session.ws.readyState === WebSocket.CONNECTING) {
    bgLog('WebSocket already connecting', { tabId, roomId });
    return;
  }

  try {
    session.ws = new WebSocket(RELAY_SERVER_URL);
    bgLog('WebSocket created', { tabId, relayUrl: RELAY_SERVER_URL });
    attachWebSocketHandlers(tabId, session);
  } catch (error) {
    const fallbackRelayUrl = normalizeRelayUrl(RELAY_SERVER_URL);
    if (fallbackRelayUrl && fallbackRelayUrl !== RELAY_SERVER_URL) {
      RELAY_SERVER_URL = fallbackRelayUrl;
      chrome.storage.sync.set({ bridgesignServerUrl: fallbackRelayUrl });
      bgLog('Retrying WebSocket with fallback relay URL', { tabId, relayUrl: RELAY_SERVER_URL });
      session.ws = new WebSocket(RELAY_SERVER_URL);
      attachWebSocketHandlers(tabId, session);
      return;
    }

    session.lastError = error && error.message ? error.message : 'WebSocket connection error';
    console.error('[BridgeSign] Failed to open WebSocket:', error);
  }
}

function attachWebSocketHandlers(tabId, session) {
  const socket = session.ws;
  if (!socket) return;

  socket.onopen = () => {
    bgLog('WebSocket open', { tabId, roomId: session.roomId, role: session.role });
    const liveSession = getSession(tabId);
    if (!liveSession || liveSession.ws !== socket) return;

    liveSession.reconnectAttempts = 0;
    socket.send(JSON.stringify({ type: 'JOIN', roomId: liveSession.roomId, role: liveSession.role }));
    flushPendingMessages(liveSession);
    sendToTab(tabId, { type: 'STATE_UPDATE', data: { connected: true, roomId: liveSession.roomId } });

    clearPingInterval(liveSession);
    liveSession.pingInterval = setInterval(() => {
      if (liveSession.ws && liveSession.ws.readyState === WebSocket.OPEN) {
        liveSession.ws.send(JSON.stringify({ type: 'PING', timestamp: Date.now() }));
      }
    }, 2000);
  };

  socket.onmessage = (event) => {
    const liveSession = getSession(tabId);
    if (!liveSession || liveSession.ws !== socket) return;

    try {
      const msg = JSON.parse(event.data);
      bgLog('WebSocket message', { tabId, type: msg.type, data: msg.data });
      if (msg.type === 'ROOM_INFO') {
        liveSession.peerCount = msg.data?.peers || 0;
        sendToTab(tabId, {
          type: 'STATE_UPDATE',
          data: {
            connected: true,
            roomId: liveSession.roomId,
            peers: liveSession.peerCount,
          },
        });
      } else if (msg.type === 'CAPTION') {
        sendToTab(tabId, { type: 'REMOTE_CAPTION', data: msg.data });
      } else if (msg.type === 'SIGN_PLAN') {
        sendToTab(tabId, { type: 'REMOTE_SIGN_PLAN', data: msg.data });
      } else if (msg.type === 'PEER_JOINED') {
        liveSession.peerCount = msg.data?.count ? Math.max(0, msg.data.count - 1) : liveSession.peerCount + 1;
        sendToTab(tabId, { type: 'PEER_JOINED', data: msg.data });
      } else if (msg.type === 'PEER_LEFT') {
        liveSession.peerCount = typeof msg.data?.count === 'number' ? Math.max(0, msg.data.count) : Math.max(0, liveSession.peerCount - 1);
        sendToTab(tabId, { type: 'PEER_LEFT', data: msg.data });
      } else if (msg.type === 'PONG') {
        liveSession.latencyMs = Date.now() - msg.timestamp;
      } else if (msg.type === 'ERROR') {
        liveSession.lastError = msg.message || 'Unknown relay error';
      }
    } catch (error) {
      console.error('[BridgeSign] Failed to parse WS message:', error);
    }
  };

  socket.onerror = (error) => {
    const liveSession = getSession(tabId);
    if (!liveSession || liveSession.ws !== socket) return;

    liveSession.lastError = 'WebSocket connection error';
    bgLog('WebSocket error', { tabId, relayUrl: RELAY_SERVER_URL, error });
    console.error('[BridgeSign] WebSocket error:', error);
    sendToTab(tabId, { type: 'STATE_UPDATE', data: { connected: false, roomId: liveSession.roomId } });
  };

  socket.onclose = () => {
    bgLog('WebSocket closed', { tabId, roomId: session.roomId, reconnectAttempts: session.reconnectAttempts });
    const liveSession = getSession(tabId);
    if (!liveSession || liveSession.ws !== socket) return;

    clearPingInterval(liveSession);
    liveSession.latencyMs = 0;
    liveSession.peerCount = 0;
    liveSession.ws = null;
    sendToTab(tabId, { type: 'STATE_UPDATE', data: { connected: false, roomId: liveSession.roomId } });

    if (!navigator.onLine || !liveSession.roomId) {
      return;
    }

    if (liveSession.reconnectAttempts >= 5) {
      liveSession.lastError = 'CONNECTION_FAILED';
      sendToTab(tabId, {
        type: 'STATE_UPDATE',
        data: { connected: false, roomId: liveSession.roomId, error: 'CONNECTION_FAILED' },
      });
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, liveSession.reconnectAttempts), 30000);
    liveSession.reconnectAttempts += 1;

    setTimeout(() => {
      const retrySession = getSession(tabId);
      if (!retrySession || !retrySession.roomId || retrySession.ws) return;
      joinRoom(tabId, retrySession.roomId, retrySession.role);
    }, delay);
  };
}

function leaveRoom(tabId) {
  const session = getSession(tabId);
  if (!session) return;

  clearPingInterval(session);
  if (session.ws && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify({ type: 'LEAVE' }));
    session.ws.close();
  }
  session.ws = null;
  session.roomId = null;
  session.latencyMs = 0;
}

function sendCaption(tabId, data) {
  const session = getSession(tabId);
  if (!session || !data) return;

  bgLog('Handling caption for relay/planner', { tabId, roomId: session.roomId, role: session.role, data });

  if (data.source !== 'meet-caption') {
    sendOrQueueSessionMessage(session, { type: 'CAPTION', data });
  }

  if ((data.source === 'speech' || data.source === 'meet-caption') && data.partial === false) {
    requestAndSendSignPlan(tabId, data);
  }
}

async function requestAndSendSignPlan(tabId, data) {
  const session = getSession(tabId);
  if (!session) return;

  bgLog('Requesting sign plan', { tabId, text: data.text, source: data.source, plannerUrl: SIGN_PLAN_SERVER_URL });

  const plannerCandidates = Array.from(new Set([
    (SIGN_PLAN_SERVER_URL || '').replace(/\/$/, ''),
    DEFAULT_PLANNER_URL,
  ].filter(Boolean)));

  let signPlan = null;
  let plannerUrl = null;
  let lastError = null;

  for (const candidate of plannerCandidates) {
    try {
      bgLog('Trying planner candidate', { tabId, candidate, text: data.text });
      const response = await fetch(`${candidate}/api/sign-plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: data.text,
          sign_language: 'ASL',
        }),
      });

      if (!response.ok) {
        throw new Error(`Planner responded with ${response.status}`);
      }

      signPlan = await response.json();
      plannerUrl = candidate;
      bgLog('Planner responded successfully', {
        tabId,
        candidate,
        mode: signPlan.mode,
        units: Array.isArray(signPlan.units) ? signPlan.units.map((unit) => unit.id) : [],
      });
      break;
    } catch (error) {
      lastError = error && error.message ? error.message : 'Failed to build sign plan';
      bgLog('Planner candidate failed', { tabId, candidate, error: lastError });
    }
  }

  if (!signPlan || !plannerUrl) {
    session.lastError = lastError || 'Failed to build sign plan';
    console.warn('[BridgeSign] Failed to build sign plan:', session.lastError);
    return;
  }

  if (plannerUrl !== SIGN_PLAN_SERVER_URL) {
    SIGN_PLAN_SERVER_URL = plannerUrl;
    chrome.storage.sync.set({ bridgesignPlannerUrl: plannerUrl });
  }

  try {
    bgLog('Delivering sign plan to local tab and relay', {
      tabId,
      roomId: session.roomId,
      text: data.text,
      units: signPlan.units.map((unit) => unit.id),
    });
    sendToTab(tabId, {
      type: 'LOCAL_SIGN_PLAN',
      data: {
        source: data.source,
        text: data.text,
        signPlan,
        timestamp: Date.now(),
      },
    });

    sendOrQueueSessionMessage(session, {
      type: 'SIGN_PLAN',
      data: {
        source: data.source,
        text: data.text,
        signPlan,
        timestamp: Date.now(),
      },
    });
  } catch (error) {
    session.lastError = error && error.message ? error.message : 'Failed to deliver sign plan';
    console.warn('[BridgeSign] Failed to deliver sign plan:', session.lastError);
  }
}

function sendOrQueueSessionMessage(session, payload) {
  if (!session || !payload) return false;

  bgLog('Sending or queueing session message', {
    roomId: session.roomId,
    role: session.role,
    type: payload.type,
    wsState: session.ws ? session.ws.readyState : null,
  });

  if (session.ws && session.ws.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify(payload));
    return true;
  }

  if (session.ws && session.ws.readyState === WebSocket.CONNECTING) {
    session.pendingMessages.push(payload);
    if (session.pendingMessages.length > MAX_PENDING_MESSAGES) {
      session.pendingMessages.shift();
    }
    return false;
  }

  session.pendingMessages.push(payload);
  if (session.pendingMessages.length > MAX_PENDING_MESSAGES) {
    session.pendingMessages.shift();
  }

  return false;
}

function flushPendingMessages(session) {
  if (!session || !session.ws || session.ws.readyState !== WebSocket.OPEN) return;

  while (session.pendingMessages.length > 0) {
    const payload = session.pendingMessages.shift();
    session.ws.send(JSON.stringify(payload));
  }
}

function sendToTab(tabId, msg) {
  const session = getSession(tabId);
  if (session && session.port) {
    bgLog('Sending message to tab', { tabId, type: msg.type, data: msg.data });
    session.port.postMessage(msg);
  }
}

function getPreferredSession() {
  for (const session of tabSessions.values()) {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      return session;
    }
  }
  for (const session of tabSessions.values()) {
    return session;
  }
  return null;
}

// ==================== OFFSCREEN DOCUMENT ====================
let creatingOffscreen;
let activeSignerTabId = null;
let offscreenReady = false;
let offscreenReadyWaiters = [];

function resolveOffscreenReady() {
  offscreenReady = true;
  for (const resolve of offscreenReadyWaiters) {
    resolve(true);
  }
  offscreenReadyWaiters = [];
}

function waitForOffscreenReady(timeoutMs = 5000) {
  if (offscreenReady) return Promise.resolve(true);

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      offscreenReadyWaiters = offscreenReadyWaiters.filter((fn) => fn !== onReady);
      resolve(false);
    }, timeoutMs);

    const onReady = () => {
      clearTimeout(timeoutId);
      resolve(true);
    };

    offscreenReadyWaiters.push(onReady);
  });
}

async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  if (creatingOffscreen) {
    await creatingOffscreen;
  } else {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: [
        chrome.offscreen.Reason.DOM_PARSER,
        chrome.offscreen.Reason.USER_MEDIA,
      ],
      justification: 'Run MediaPipe ML model for ASL and capture tab audio for transcription'
    });
    await creatingOffscreen;
    creatingOffscreen = null;
  }
}

async function hasOffscreenDocument() {
  if ('getContexts' in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
    });
    return contexts.length > 0;
  }

  const matchedClients = await clients.matchAll();
  return matchedClients.some((c) => c.url.includes('offscreen.html'));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_OFFSCREEN') {
    setupOffscreenDocument()
      .then(() => waitForOffscreenReady())
      .then((ready) => sendResponse({ success: ready }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  if (msg.type === 'PROCESS_FRAME') {
    if (sender.tab && sender.tab.id) {
      activeSignerTabId = sender.tab.id;
    }
    chrome.runtime.sendMessage({
      type: 'OFFSCREEN_PROCESS_FRAME',
      dataUrl: msg.dataUrl,
    }).catch(() => {});
    return false;
  }

  if (msg.type === 'HAND_LANDMARKS') {
    if (activeSignerTabId) {
      chrome.tabs.sendMessage(activeSignerTabId, msg).catch(() => {});
    }
    return false;
  }

  if (msg.type === 'OFFSCREEN_READY') {
    resolveOffscreenReady();
    return false;
  }

  if (msg.type === 'GET_STATUS') {
    const tabId = msg.tabId || (sender.tab && sender.tab.id);
    const session = getSession(tabId);
    sendResponse({
      connected: Boolean(session && session.ws && session.ws.readyState === WebSocket.OPEN),
      roomId: session ? session.roomId : null,
      peers: session ? session.peerCount : 0,
      error: session ? session.lastError : null,
      latency: session ? session.latencyMs : 0,
      relayUrl: RELAY_SERVER_URL,
      plannerUrl: SIGN_PLAN_SERVER_URL,
    });
    if (session) {
      session.lastError = null;
    }
    return true;
  }

  if (msg.type === 'FORCE_RECONNECT') {
    const tabId = msg.tabId || (sender.tab && sender.tab.id);
    const session = getSession(tabId);
    if (session && session.roomId) {
      if (session.ws && session.ws.readyState !== WebSocket.CLOSED) {
        session.ws.close();
      }
      session.reconnectAttempts = 0;
      setTimeout(() => {
        joinRoom(tabId, session.roomId, session.role);
      }, 500);
    }
    sendResponse({ success: true });
    return true;
  }

});

// SignFlow Background Service Worker
// Manages extension state and WebSocket connection to relay server

let RELAY_SERVER_URL = 'ws://localhost:3001';
chrome.storage.sync.get(['signflowServerUrl'], (res) => {
  if (res.signflowServerUrl) RELAY_SERVER_URL = res.signflowServerUrl;
});

let ws = null;
let currentRoomId = null;
let currentRole = null;
let connectedPorts = new Map(); // tabId -> port
let reconnectAttempts = 0;

// Listen for connections from content scripts
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'signflow') return;

  const tabId = port.sender.tab.id;
  connectedPorts.set(tabId, port);

  port.onMessage.addListener((msg) => {
    handleContentMessage(tabId, msg);
  });

  port.onDisconnect.addListener(() => {
    connectedPorts.delete(tabId);
    if (connectedPorts.size === 0 && ws) {
      ws.close();
      ws = null;
      currentRoomId = null;
    }
  });
});

// Handle messages from content script
function handleContentMessage(tabId, msg) {
  switch (msg.type) {
    case 'JOIN_ROOM':
      joinRoom(msg.roomId, msg.role);
      break;
    case 'LEAVE_ROOM':
      leaveRoom();
      break;
    case 'CAPTION':
      sendCaption(msg.data);
      break;
    case 'GET_STATE':
      sendToTab(tabId, {
        type: 'STATE_UPDATE',
        data: {
          connected: ws && ws.readyState === WebSocket.OPEN,
          roomId: currentRoomId,
        },
      });
      break;
  }
}

// Connect to WebSocket relay and join room
function joinRoom(roomId, role) {
  currentRoomId = roomId;
  if (role) currentRole = role;

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'JOIN', roomId, role: currentRole }));
    broadcastToTabs({ type: 'STATE_UPDATE', data: { connected: true, roomId } });
    return;
  }

  ws = new WebSocket(RELAY_SERVER_URL);

  ws.onopen = () => {
    reconnectAttempts = 0;
    ws.send(JSON.stringify({ type: 'JOIN', roomId, role: currentRole }));
    broadcastToTabs({ type: 'STATE_UPDATE', data: { connected: true, roomId } });
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'CAPTION') {
        broadcastToTabs({ type: 'REMOTE_CAPTION', data: msg.data });
      } else if (msg.type === 'PEER_JOINED') {
        broadcastToTabs({ type: 'PEER_JOINED', data: msg.data });
      } else if (msg.type === 'PEER_LEFT') {
        broadcastToTabs({ type: 'PEER_LEFT', data: msg.data });
      }
    } catch (e) {
      console.error('[SignFlow] Failed to parse WS message:', e);
    }
  };

  ws.onerror = (error) => {
    console.error('[SignFlow] WebSocket error:', error);
    broadcastToTabs({ type: 'STATE_UPDATE', data: { connected: false, roomId: currentRoomId } });
  };

  ws.onclose = () => {
    broadcastToTabs({ type: 'STATE_UPDATE', data: { connected: false, roomId: currentRoomId } });
    
    // Exponential backoff
    const baseDelay = 1000;
    const maxDelay = 30000;
    const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts), maxDelay);
    reconnectAttempts++;
    
    setTimeout(() => {
      if (currentRoomId && connectedPorts.size > 0) {
        joinRoom(currentRoomId, currentRole);
      }
    }, delay);
  };
}

function leaveRoom() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'LEAVE' }));
  }
  currentRoomId = null;
}

function sendCaption(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'CAPTION', data }));
  }
}

function sendToTab(tabId, msg) {
  const port = connectedPorts.get(tabId);
  if (port) {
    port.postMessage(msg);
  }
}

function broadcastToTabs(msg) {
  for (const port of connectedPorts.values()) {
    port.postMessage(msg);
  }
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
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Run MediaPipe ML model for ASL'
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
  } else {
    // Fallback for older MV3 implementations
    const matchedClients = await clients.matchAll();
    return matchedClients.some((c) => c.url.includes('offscreen.html'));
  }
}

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_OFFSCREEN') {
    setupOffscreenDocument()
      .then(() => waitForOffscreenReady())
      .then((ready) => sendResponse({ success: ready }))
      .catch(() => sendResponse({ success: false }));
    return true; // Keep channel open for async response
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
    sendResponse({
      connected: ws && ws.readyState === WebSocket.OPEN,
      roomId: currentRoomId,
      peers: connectedPorts.size,
    });
    return true;
  }
});

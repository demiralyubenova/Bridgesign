// BridgeSign Popup Script
// Shows extension status when clicking the browser action icon

document.addEventListener('DOMContentLoaded', () => {
  const serverInput = document.getElementById('info-server');
  const saveBtn = document.getElementById('btn-save-server');
  const plannerInput = document.getElementById('info-planner');
  const savePlannerBtn = document.getElementById('btn-save-planner');
  const relayDefaultUrl = 'ws://localhost:3001';
  const plannerDefaultUrl = 'http://localhost:8001';

  function normalizeRelayUrl(url) {
    return url === 'ws://localhost:3001' ? relayDefaultUrl : url;
  }

  function normalizePlannerUrl(url) {
    return url === 'http://localhost:8001' || url === 'http://127.0.0.1:8001'
      ? plannerDefaultUrl
      : url;
  }

  // Load saved server URL
  chrome.storage.sync.get(['bridgesignServerUrl', 'bridgesignPlannerUrl', 'signflowServerUrl', 'signflowPlannerUrl'], (res) => {
    if (res.bridgesignServerUrl || res.signflowServerUrl) {
      serverInput.value = normalizeRelayUrl(res.bridgesignServerUrl || res.signflowServerUrl);
    } else {
      serverInput.value = relayDefaultUrl;
    }

    if (res.bridgesignPlannerUrl || res.signflowPlannerUrl) {
      plannerInput.value = normalizePlannerUrl(res.bridgesignPlannerUrl || res.signflowPlannerUrl);
    } else {
      plannerInput.value = plannerDefaultUrl;
    }

    if (res.bridgesignServerUrl !== serverInput.value || res.bridgesignPlannerUrl !== plannerInput.value) {
      chrome.storage.sync.set({
        bridgesignServerUrl: serverInput.value,
        bridgesignPlannerUrl: plannerInput.value,
      });
    }
  });

  // Save server URL
  saveBtn.addEventListener('click', () => {
    const newUrl = normalizeRelayUrl(serverInput.value.trim());
    if (newUrl) {
      serverInput.value = newUrl;
      chrome.storage.sync.set({ bridgesignServerUrl: newUrl }, () => {
        saveBtn.textContent = 'Saved!';
        saveBtn.classList.add('success');
        setTimeout(() => {
          saveBtn.textContent = 'Save';
          saveBtn.classList.remove('success');
        }, 2000);
      });
    }
  });

  savePlannerBtn.addEventListener('click', () => {
    const newUrl = normalizePlannerUrl(plannerInput.value.trim());
    if (newUrl) {
      plannerInput.value = newUrl;
      chrome.storage.sync.set({ bridgesignPlannerUrl: newUrl }, () => {
        savePlannerBtn.textContent = 'Saved!';
        savePlannerBtn.classList.add('success');
        setTimeout(() => {
          savePlannerBtn.textContent = 'Save';
          savePlannerBtn.classList.remove('success');
        }, 2000);
      });
    }
  });

  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      return;
    }

    const statusDot = document.querySelector('.status-dot');
    const statusLabel = document.querySelector('.status-label');
    const infoRoom = document.getElementById('info-room');
    const infoRole = document.getElementById('info-role');
    const infoSync = document.getElementById('info-sync');
    const infoPeers = document.getElementById('info-peers');
    const infoLatency = document.getElementById('info-latency');
    const popupError = document.getElementById('popup-error');

    if (response.error) {
      popupError.textContent = response.error;
      popupError.style.display = 'block';
    } else {
      popupError.style.display = 'none';
    }

    if (response.connected) {
      statusDot.classList.add('connected');
      statusLabel.textContent = 'Connected to meeting';
    } else if (response.roomId) {
      statusLabel.textContent = 'Connecting...';
    } else {
      statusLabel.textContent = 'Not in a meeting';
    }

    infoRoom.textContent = response.roomId || '—';
    infoSync.textContent = response.connected ? 'Connected' : 'Disconnected';
    infoPeers.textContent = response.peers !== undefined ? response.peers : '—';
    
    if (response.connected && response.latency > 0) {
      infoLatency.textContent = `${response.latency}ms`;
      infoLatency.style.display = 'inline-block';
      if (response.latency > 200) {
        infoLatency.style.color = '#fca5a5';
        infoLatency.style.background = 'rgba(239, 68, 68, 0.2)';
      } else if (response.latency > 100) {
        infoLatency.style.color = '#fef08a';
        infoLatency.style.background = 'rgba(253, 224, 71, 0.2)';
      } else {
        infoLatency.style.color = '#86efac';
        infoLatency.style.background = 'rgba(34, 197, 94, 0.2)';
      }
    } else {
      infoLatency.style.display = 'none';
    }

    // Get role from storage
    chrome.storage.local.get('bridgesignRole', (data) => {
      const role = data.bridgesignRole;
      infoRole.textContent = role
        ? (role === 'signer' ? '🤟 Signer' : '🗣️ Speaker')
        : '—';
    });
  });

  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        const tabId = tabs[0].id;
        
        btnRefresh.textContent = 'Refreshing...';
        btnRefresh.disabled = true;
        
        chrome.runtime.sendMessage({ 
          type: 'FORCE_RECONNECT', 
          tabId: tabId
        }, (res) => {
          setTimeout(() => {
            btnRefresh.textContent = '🔄 Refresh Connection';
            btnRefresh.disabled = false;
            // Optionally close the popup or let the user see the status update via GET_STATUS interval if we had one
          }, 1000);
        });
      });
    });
  }
});

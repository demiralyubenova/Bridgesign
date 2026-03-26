// BridgeSign Popup Script
// Shows extension status when clicking the browser action icon

document.addEventListener('DOMContentLoaded', () => {
  const serverInput = document.getElementById('info-server');
  const saveBtn = document.getElementById('btn-save-server');

  // Load saved server URL
  chrome.storage.sync.get(['bridgesignServerUrl'], (res) => {
    if (res.bridgesignServerUrl) {
      serverInput.value = res.bridgesignServerUrl;
    } else {
      serverInput.value = 'ws://localhost:3001';
    }
  });

  // Save server URL
  saveBtn.addEventListener('click', () => {
    const newUrl = serverInput.value.trim();
    if (newUrl) {
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
      infoRole.textContent = data.bridgesignRole
        ? (data.bridgesignRole === 'signer' ? '🤟 Signer' : '🗣️ Speaker')
        : '—';
    });
  });
});

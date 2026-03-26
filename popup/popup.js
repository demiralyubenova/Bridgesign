// SignFlow Popup Script
// Shows extension status when clicking the browser action icon

document.addEventListener('DOMContentLoaded', () => {
  const serverInput = document.getElementById('info-server');
  const saveBtn = document.getElementById('btn-save-server');

  // Load saved server URL
  chrome.storage.sync.get(['signflowServerUrl'], (res) => {
    if (res.signflowServerUrl) {
      serverInput.value = res.signflowServerUrl;
    } else {
      serverInput.value = 'ws://localhost:3001';
    }
  });

  // Save server URL
  saveBtn.addEventListener('click', () => {
    const newUrl = serverInput.value.trim();
    if (newUrl) {
      chrome.storage.sync.set({ signflowServerUrl: newUrl }, () => {
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

    // Get role from storage
    chrome.storage.local.get('signflowRole', (data) => {
      infoRole.textContent = data.signflowRole
        ? (data.signflowRole === 'signer' ? '🤟 Signer' : '🗣️ Speaker')
        : '—';
    });
  });
});

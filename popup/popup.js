// SignFlow Popup Script
// Shows extension status when clicking the browser action icon

document.addEventListener('DOMContentLoaded', () => {
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      return;
    }

    const statusDot = document.querySelector('.status-dot');
    const statusLabel = document.querySelector('.status-label');
    const infoRoom = document.getElementById('info-room');
    const infoRole = document.getElementById('info-role');
    const infoSync = document.getElementById('info-sync');

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

    // Get role from storage
    chrome.storage.local.get('signflowRole', (data) => {
      infoRole.textContent = data.signflowRole
        ? (data.signflowRole === 'signer' ? '🤟 Signer' : '🗣️ Speaker')
        : '—';
    });
  });
});

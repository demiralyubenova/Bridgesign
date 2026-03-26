// BridgeSign Virtual Camera
// Patches getUserMedia to route webcam through a canvas for subtitle overlay.
// Runs at document_start in MAIN world.

(function () {
  'use strict';

  if (window.__BridgeSignVCam) return;

  const CANVAS_FPS = 30;
  let originalStream = null;
  let canvasStream = null;
  let canvas = null;
  let ctx = null;
  let video = null;
  let drawLoopId = null;
  let currentCaption = '';
  let captionExpiry = 0;
  let active = false;

  const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  navigator.mediaDevices.getUserMedia = async function (constraints) {
    const stream = await realGetUserMedia(constraints);

    if (!constraints || !constraints.video) return stream;

    try {
      originalStream = stream;
      const virtualStream = await createVirtualStream(stream);
      return virtualStream;
    } catch (e) {
      console.warn('[BridgeSign VCam] Fallback to raw stream:', e);
      return stream;
    }
  };

  async function createVirtualStream(stream) {
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return stream;

    const settings = videoTrack.getSettings();
    const w = settings.width || 640;
    const h = settings.height || 480;

    // Clean up previous
    if (video) { video.srcObject = null; video.remove(); }
    if (canvas) canvas.remove();
    if (drawLoopId) cancelAnimationFrame(drawLoopId);

    // Hidden video to read webcam frames from
    video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.muted = true;
    video.srcObject = stream;
    video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;';

    // Wait for DOM to be ready before appending
    const parent = document.body || document.documentElement;
    parent.appendChild(video);

    // Explicitly play and wait for first frame
    await video.play();
    await waitForVideoReady(video);

    // Canvas at the same resolution
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;';
    parent.appendChild(canvas);
    ctx = canvas.getContext('2d');

    // Draw the first frame immediately so captureStream gets valid data
    ctx.drawImage(video, 0, 0, w, h);

    // Start the continuous draw loop
    startDrawLoop();

    // Create the output stream from the canvas
    canvasStream = canvas.captureStream(CANVAS_FPS);

    // Keep audio tracks
    for (const track of stream.getAudioTracks()) {
      canvasStream.addTrack(track);
    }

    return canvasStream;
  }

  function waitForVideoReady(vid, timeout = 5000) {
    return new Promise((resolve) => {
      if (vid.readyState >= 2) return resolve();

      const timer = setTimeout(resolve, timeout);
      vid.addEventListener('loadeddata', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
    });
  }

  function startDrawLoop() {
    function draw() {
      if (!video || !ctx || !canvas) return;

      const w = canvas.width;
      const h = canvas.height;

      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, w, h);
      }

      if (active && currentCaption && Date.now() < captionExpiry) {
        drawSubtitle(currentCaption, w, h);
      }

      drawLoopId = requestAnimationFrame(draw);
    }
    drawLoopId = requestAnimationFrame(draw);
  }

  function drawSubtitle(text, w, h) {
    const fontSize = Math.max(16, Math.round(h * 0.045));
    const padding = 12;
    const margin = 20;
    const maxWidth = w - margin * 2;

    ctx.font = `bold ${fontSize}px Inter, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const lines = wrapText(ctx, text, maxWidth);
    const lineHeight = fontSize * 1.3;
    const blockHeight = lines.length * lineHeight + padding * 2;
    const blockY = h - margin - blockHeight;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    roundRect(ctx, margin, blockY, w - margin * 2, blockHeight, 8);
    ctx.fill();

    ctx.strokeStyle = 'rgba(99, 102, 241, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(margin + 8, blockY);
    ctx.lineTo(w - margin - 8, blockY);
    ctx.stroke();

    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#ffffff';
    lines.forEach((line, i) => {
      ctx.fillText(line, w / 2, blockY + padding + (i + 1) * lineHeight);
    });
    ctx.shadowBlur = 0;
  }

  function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let current = '';
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  window.__BridgeSignVCam = {
    activate() { active = true; },
    setCaptionText(text) {
      currentCaption = text || '';
      captionExpiry = Date.now() + 8000;
    },
    stop() {
      active = false;
      currentCaption = '';
    },
    isActive() { return active; }
  };

  // === CROSS-WORLD BRIDGE ===
  // content.js runs in ISOLATED world and can't access window.__BridgeSignVCam.
  // Both worlds share the same `document`, so we use CustomEvents.
  document.addEventListener('bridgesign-vcam-activate', () => {
    active = true;
  });

  document.addEventListener('bridgesign-vcam-caption', (e) => {
    currentCaption = (e.detail && e.detail.text) || '';
    captionExpiry = Date.now() + 8000;
  });

  document.addEventListener('bridgesign-vcam-stop', () => {
    active = false;
    currentCaption = '';
  });
})();

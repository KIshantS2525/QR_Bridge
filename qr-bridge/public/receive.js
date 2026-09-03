const viewfinder = document.getElementById('viewfinder');
const placeholder = document.getElementById('camera-placeholder');
const statusEl = document.getElementById('status');
const cameraToggle = document.getElementById('camera-toggle');
const resetBtn = document.getElementById('reset-btn');
const progressTrack = document.getElementById('progress-track');
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const progressText = document.getElementById('progress-text');
const progressPct = document.getElementById('progress-pct');
const resultCard = document.getElementById('result-card');
const resultBody = document.getElementById('result-body');
const resultActions = document.getElementById('result-actions');

const collector = createCollector();

let video = null;
let scanCanvas = null;
let scanCtx = null;
let stream = null;
let rafId = null;
let lastDecodedRaw = null;
let lastDecodedAt = 0;

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } }
    });
  } catch (err) {
    statusEl.textContent = 'Could not open the camera: ' + err.message + '. Camera access needs HTTPS (or localhost) — check the README.';
    return;
  }
  viewfinder.innerHTML = '';
  viewfinder.classList.remove('empty');

  video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  viewfinder.appendChild(video);

  const badge = document.createElement('div');
  badge.className = 'live-badge';
  badge.innerHTML = '<span class="pulse"></span> LIVE';
  viewfinder.appendChild(badge);

  await video.play();

  scanCanvas = document.createElement('canvas');
  scanCtx = scanCanvas.getContext('2d', { willReadFrequently: true });

  cameraToggle.textContent = 'Stop camera';
  statusEl.textContent = 'Scanning… hold the phone steady over the code.';
  tick();
}

function stopCamera() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (stream) stream.getTracks().forEach(t => t.stop());
  stream = null;
  viewfinder.innerHTML = '';
  viewfinder.classList.add('empty');
  const p = document.createElement('div');
  p.className = 'placeholder';
  p.textContent = 'Tap "Start camera" to scan a QR code from the other screen';
  viewfinder.appendChild(p);
  cameraToggle.textContent = 'Start camera';
  statusEl.textContent = 'Camera is off.';
}

function tick() {
  if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
    rafId = requestAnimationFrame(tick);
    return;
  }
  scanCanvas.width = video.videoWidth;
  scanCanvas.height = video.videoHeight;
  scanCtx.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
  const imageData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
  const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });

  if (code && code.data) {
    const now = Date.now();
    if (code.data !== lastDecodedRaw || now - lastDecodedAt > 250) {
      lastDecodedRaw = code.data;
      lastDecodedAt = now;
      handleDecoded(code.data);
    }
  }
  rafId = requestAnimationFrame(tick);
}

function handleDecoded(raw) {
  const outcome = collector.ingest(raw);

  if (outcome.type === 'progress') {
    progressTrack.style.display = 'block';
    progressLabel.style.display = 'flex';
    const pct = Math.round((outcome.received / outcome.total) * 100);
    progressFill.style.width = pct + '%';
    progressText.textContent = `Received ${outcome.received} of ${outcome.total} frames`;
    progressPct.textContent = pct + '%';
    statusEl.textContent = 'Keep the camera steady — reassembling the transfer.';
    statusEl.classList.remove('good');
    return;
  }

  progressTrack.style.display = 'none';
  progressLabel.style.display = 'none';
  statusEl.textContent = 'Done — decoded successfully.';
  statusEl.classList.add('good');
  showResult(outcome);
}

function showResult(outcome) {
  resultCard.style.display = 'block';
  resultBody.innerHTML = '';
  resultActions.innerHTML = '';

  if (outcome.type === 'text') {
    const div = document.createElement('div');
    div.className = 'result-text';
    div.textContent = outcome.text;
    resultBody.appendChild(div);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-primary';
    copyBtn.textContent = 'Copy text';
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(outcome.text);
      copyBtn.textContent = 'Copied ✓';
      setTimeout(() => (copyBtn.textContent = 'Copy text'), 1500);
    };
    resultActions.appendChild(copyBtn);
  }

  if (outcome.type === 'file') {
    const blob = new Blob([outcome.bytes], { type: outcome.mime });
    const url = URL.createObjectURL(blob);

    if (outcome.mime.startsWith('audio/')) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.src = url;
      resultBody.appendChild(audio);
    } else if (outcome.mime.startsWith('image/')) {
      const wrap = document.createElement('div');
      wrap.className = 'file-preview';
      const img = document.createElement('img');
      img.src = url;
      wrap.appendChild(img);
      resultBody.appendChild(wrap);
    } else {
      const p = document.createElement('p');
      p.className = 'status-line';
      p.textContent = `Received a ${outcome.bytes.length}-byte file.`;
      resultBody.appendChild(p);
    }

    const ext = outcome.mime.split('/')[1] || 'bin';
    const dl = document.createElement('a');
    dl.className = 'btn';
    dl.textContent = 'Download';
    dl.href = url;
    dl.download = 'qr-bridge-received.' + ext;
    resultActions.appendChild(dl);
  }

  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

cameraToggle.addEventListener('click', () => {
  if (stream) stopCamera();
  else startCamera();
});

resetBtn.addEventListener('click', () => {
  collector.reset();
  lastDecodedRaw = null;
  progressTrack.style.display = 'none';
  progressLabel.style.display = 'none';
  resultCard.style.display = 'none';
  statusEl.classList.remove('good');
  statusEl.textContent = stream ? 'Scanning… hold the phone steady over the code.' : 'Camera is off.';
});

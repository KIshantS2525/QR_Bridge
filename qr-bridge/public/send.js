// ---------- tab switching ----------
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.panel).classList.add('active');
  });
});

// ---------- shared output area ----------
const outputCard = document.getElementById('output-card');
const viewfinder = document.getElementById('viewfinder');
const progressTrack = document.getElementById('progress-track');
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');
const progressText = document.getElementById('progress-text');
const loopText = document.getElementById('loop-text');
const speedRow = document.getElementById('speed-row');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');
const outputActions = document.getElementById('output-actions');
const outputStatus = document.getElementById('output-status');

let canvas = null;
let timer = null;
let frames = [];
let frameIndex = 0;
let loopsDone = 0;
let recorder = null;
let recordedChunks = [];

function resetViewfinder() {
  clearInterval(timer);
  timer = null;
  viewfinder.innerHTML = '';
  canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  viewfinder.appendChild(canvas);
  viewfinder.classList.remove('empty');
}

function drawFrame(text) {
  QRCode.toCanvas(canvas, text, { margin: 1, errorCorrectionLevel: frames.length > 1 ? 'L' : 'M', width: 512 }, () => {});
}

function stopPlayback() {
  clearInterval(timer);
  timer = null;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

function startLoop({ record = false, maxLoops = Infinity, onFinish = null } = {}) {
  clearInterval(timer);
  frameIndex = 0;
  loopsDone = 0;
  const speed = Number(speedSlider.value);

  if (record) {
    recordedChunks = [];
    const stream = canvas.captureStream(30);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9' : 'video/webm';
    recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = e => { if (e.data.size) recordedChunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'qr-bridge-transfer.webm';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      outputStatus.textContent = 'Video downloaded — it plays back the full QR sequence.';
      outputStatus.classList.add('good');
      if (onFinish) onFinish();
    };
    recorder.start();
  }

  drawFrame(frames[0]);
  updateProgressUI();

  timer = setInterval(() => {
    frameIndex++;
    if (frameIndex >= frames.length) {
      frameIndex = 0;
      loopsDone++;
      if (record && loopsDone >= maxLoops) {
        stopPlayback();
        return;
      }
    }
    drawFrame(frames[frameIndex]);
    updateProgressUI();
  }, speed);
}

function updateProgressUI() {
  if (frames.length <= 1) return;
  progressFill.style.width = ((frameIndex + 1) / frames.length * 100) + '%';
  progressText.textContent = `Frame ${frameIndex + 1} of ${frames.length}`;
  loopText.textContent = `loop ${loopsDone + 1}`;
}

speedSlider.addEventListener('input', () => {
  speedValue.textContent = speedSlider.value + 'ms';
  if (timer) startLoop({ record: false, maxLoops: Infinity });
});

// Presents a freshly built frame set: single static QR, or an animated one.
function presentFrames(newFrames, meta = {}) {
  frames = newFrames;
  outputCard.style.display = 'block';
  outputActions.innerHTML = '';
  outputStatus.textContent = '';
  outputStatus.classList.remove('good');
  resetViewfinder();

  if (frames.length === 1) {
    progressTrack.style.display = 'none';
    progressLabel.style.display = 'none';
    speedRow.style.display = 'none';
    drawFrame(frames[0]);

    const dl = document.createElement('button');
    dl.className = 'btn btn-primary';
    dl.textContent = 'Download PNG';
    dl.onclick = () => {
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = 'qr-bridge-code.png';
      a.click();
    };
    outputActions.appendChild(dl);
    outputStatus.textContent = 'One code — scan it any time, it never expires or moves.';
  } else {
    progressTrack.style.display = 'block';
    progressLabel.style.display = 'flex';
    speedRow.style.display = 'flex';

    const streamBtn = document.createElement('button');
    streamBtn.className = 'btn btn-primary';
    streamBtn.textContent = '▶ Start streaming';
    streamBtn.onclick = () => {
      if (timer) {
        stopPlayback();
        streamBtn.textContent = '▶ Start streaming';
      } else {
        startLoop({ record: false });
        streamBtn.textContent = '■ Stop streaming';
        outputStatus.textContent = 'Streaming live — point the phone at the screen. It loops until you stop it.';
      }
    };
    outputActions.appendChild(streamBtn);

    const videoBtn = document.createElement('button');
    videoBtn.className = 'btn';
    videoBtn.textContent = 'Download as video';
    videoBtn.onclick = () => {
      videoBtn.disabled = true;
      streamBtn.disabled = true;
      outputStatus.textContent = 'Recording two full loops…';
      startLoop({ record: true, maxLoops: 2, onFinish: () => {
        videoBtn.disabled = false;
        streamBtn.disabled = false;
        streamBtn.textContent = '▶ Start streaming';
      }});
    };
    outputActions.appendChild(videoBtn);

    outputStatus.textContent = `${frames.length} frames, ${meta.byteLength ? Math.round(meta.byteLength/1024) + ' KB' : ''} — press start and scan on the phone.`;
  }
  outputCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- TEXT ----------
document.getElementById('text-generate').addEventListener('click', async () => {
  const val = document.getElementById('text-input').value.trim();
  if (!val) return;
  const { frames: f, single } = await textToFrames(val);
  document.getElementById('text-hint').textContent = single
    ? 'Fits in a single QR code.'
    : `Split into ${f.length} frames — it will stream instead of one static code.`;
  presentFrames(f);
});

// ---------- AUDIO ----------
let mediaRecorderAudio, audioChunks = [], recordedBlob = null;
document.getElementById('audio-record').addEventListener('click', async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioChunks = [];
  mediaRecorderAudio = new MediaRecorder(stream);
  mediaRecorderAudio.ondataavailable = e => audioChunks.push(e.data);
  mediaRecorderAudio.onstop = () => {
    recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const preview = document.getElementById('audio-preview');
    preview.src = URL.createObjectURL(recordedBlob);
    preview.style.display = 'block';
    document.getElementById('audio-generate').disabled = false;
    stream.getTracks().forEach(t => t.stop());
  };
  mediaRecorderAudio.start();
  document.getElementById('audio-record').disabled = true;
  document.getElementById('audio-stop').disabled = false;
  document.getElementById('audio-hint').textContent = 'Recording… click stop when done.';
});

document.getElementById('audio-stop').addEventListener('click', () => {
  mediaRecorderAudio.stop();
  document.getElementById('audio-record').disabled = false;
  document.getElementById('audio-stop').disabled = true;
  document.getElementById('audio-hint').textContent = 'Clip ready below. Re-record any time before encoding.';
});

document.getElementById('audio-generate').addEventListener('click', async () => {
  if (!recordedBlob) return;
  const { frames: f, byteLength } = await blobToFrames(recordedBlob, 'audio/webm');
  presentFrames(f, { byteLength });
});

// ---------- IMAGE ----------
let selectedImage = null;
document.getElementById('image-input').addEventListener('change', e => {
  selectedImage = e.target.files[0] || null;
  const preview = document.getElementById('image-preview');
  preview.innerHTML = '';
  if (selectedImage) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(selectedImage);
    preview.appendChild(img);
    document.getElementById('image-generate').disabled = false;
  } else {
    document.getElementById('image-generate').disabled = true;
  }
});

document.getElementById('image-generate').addEventListener('click', async () => {
  if (!selectedImage) return;
  const { frames: f, byteLength } = await blobToFrames(selectedImage, selectedImage.type || 'image/jpeg');
  presentFrames(f, { byteLength });
});

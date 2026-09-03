/* shared.js
   Common helpers for splitting data into QR-sized chunks and putting it
   back together again. Nothing in here ever touches the network — the
   only way bytes move between devices is through the QR frames themselves.
*/

// How many base64 characters live inside a single QR frame.
// Kept small on purpose: a smaller QR is a QR a phone camera can read
// at speed. Raise it and you fit more per frame but need a steadier hand.
const CHUNK_LEN = 480;

function randomId() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
}

// bytes -> base64 (works for arbitrary binary, unlike btoa on raw strings)
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Splits a Blob into an array of QR-frame strings.
// Every frame is small JSON: {t:'c', id, i, n, m, d}
async function blobToFrames(blob, mime) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const b64 = bytesToBase64(buf);
  const id = randomId();
  const n = Math.max(1, Math.ceil(b64.length / CHUNK_LEN));
  const frames = [];
  for (let i = 0; i < n; i++) {
    const d = b64.slice(i * CHUNK_LEN, (i + 1) * CHUNK_LEN);
    frames.push(JSON.stringify({ t: 'c', id, i, n, m: mime, d }));
  }
  return { frames, id, n, byteLength: buf.length };
}

// A plain sentence/paragraph, short enough to live in one frame, is sent
// completely unwrapped — it's just the text itself, nothing to parse.
// Longer text gets chunked exactly like a file so it survives multiple frames.
async function textToFrames(text) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= CHUNK_LEN) {
    return { frames: [text], id: null, n: 1, single: true };
  }
  const blob = new Blob([bytes]);
  return blobToFrames(blob, 'text/plain');
}

// Receiver-side chunk collector. Feed it every decoded QR string; it tells
// you what happened and, once complete, hands back the reassembled bytes.
function createCollector() {
  let id = null;
  let total = 0;
  const parts = new Map();

  function reset() {
    id = null;
    total = 0;
    parts.clear();
  }

  function ingest(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return { type: 'text', text: raw };
    }
    if (!msg || msg.t !== 'c' || typeof msg.i !== 'number' || typeof msg.n !== 'number') {
      return { type: 'text', text: raw };
    }
    if (msg.id !== id) {
      reset();
      id = msg.id;
      total = msg.n;
    }
    if (!parts.has(msg.i)) parts.set(msg.i, msg.d);

    if (parts.size < total) {
      return { type: 'progress', received: parts.size, total, mime: msg.m };
    }
    let b64 = '';
    for (let i = 0; i < total; i++) b64 += parts.get(i) || '';
    const bytes = base64ToBytes(b64);
    const mime = msg.m || 'application/octet-stream';
    reset();
    if (mime === 'text/plain') {
      return { type: 'text', text: new TextDecoder().decode(bytes) };
    }
    return { type: 'file', bytes, mime };
  }

  return { ingest, reset, get progress() { return { received: parts.size, total }; } };
}

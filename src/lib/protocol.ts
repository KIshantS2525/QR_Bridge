// @ts-nocheck
// Chunk protocol for QR-code file transfer.
//
// Each QR frame carries one JSON object:
// {
//   v: 1,              protocol version
//   i: <int>,          chunk index (0-based)
//   n: <int>,          total chunk count
//   id: <str>,         short random transfer id (so a stray/late frame from a
//                      previous transfer can't get mixed into a new one)
//   name: <str>,       file name (only needs to be present once; we still
//                      repeat it in frame 0 and the last frame for redundancy)
//   size: <int>,       original (pre-gzip) byte size, informational only
//   hash: <str>,       SHA-256 hex of the ORIGINAL (pre-gzip) bytes
//   gz: 0|1,           1 if payload bytes are gzip-compressed
//   d: <base64 str>    this chunk's slice of the (possibly gzipped) payload
// }
//
// We deliberately keep this flat and dependency-free (no protobuf/msgpack)
// so the wire format is easy to inspect while debugging a scan.

import * as pako from 'pako'

// Conservative default: JSON overhead + base64 (33% bigger than raw) has to
// fit comfortably inside a QR code at a scannable size. 700 raw bytes ->
// ~933 base64 chars -> a QR code that's still easy to read on a phone screen
// from a foot away with EC level M. Tune down for flakier cameras, up for
// fewer frames.
export const DEFAULT_CHUNK_BYTES = 700

export function bytesToBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Build the ordered list of QR frame strings for a file.
 * @param {File|Blob} file
 * @param {object} opts { chunkBytes, useGzip, onProgress }
 * @returns {Promise<{frames: string[], meta: object}>}
 */
export async function encodeFileToFrames(file, opts = {}) {
  const { chunkBytes = DEFAULT_CHUNK_BYTES, useGzip = true, onProgress } = opts

  const originalBuf = new Uint8Array(await file.arrayBuffer())
  const hash = await sha256Hex(originalBuf)

  let payload = originalBuf
  let gz = 0
  if (useGzip) {
    const compressed = pako.gzip(originalBuf)
    // Only keep the compressed version if it's actually smaller
    // (already-compressed formats like jpg/zip/mp4 often aren't).
    if (compressed.length < originalBuf.length) {
      payload = compressed
      gz = 1
    }
  }

  const id = randomId()
  const name = file.name || 'file.bin'
  const size = originalBuf.length

  const rawChunks = []
  for (let offset = 0; offset < payload.length; offset += chunkBytes) {
    rawChunks.push(payload.subarray(offset, offset + chunkBytes))
  }
  // Empty file edge case: still send one (empty) chunk so the receiver gets metadata.
  if (rawChunks.length === 0) rawChunks.push(new Uint8Array(0))

  const n = rawChunks.length
  const frames = rawChunks.map((chunkBytesArr, i) => {
    const frame = {
      v: 1,
      i,
      n,
      id,
      name,
      size,
      hash,
      gz,
      d: bytesToBase64(chunkBytesArr),
    }
    onProgress?.(i + 1, n)
    return JSON.stringify(frame)
  })

  return { frames, meta: { id, name, size, hash, gz, chunkCount: n, compressedSize: payload.length } }
}

/**
 * Incremental receiver-side collector. Feed it decoded QR text as it scans;
 * it tracks progress and tells you when the transfer is complete.
 */
export class FrameCollector {
  id: string | null
  total: number | null
  name: string | null
  size: number | null
  hash: string | null
  gz: number
  chunks: Map<number, Uint8Array>
  bytesReceived: number
  startTime: number | null
  completeTime: number | null

  constructor() {
    this.id = null
    this.total = null
    this.name = null
    this.size = null
    this.hash = null
    this.gz = 0
    this.chunks = new Map() // index -> Uint8Array
    this.bytesReceived = 0
    this.startTime = null
    this.completeTime = null
  }

  /** @returns {{ok:boolean, duplicate?:boolean, error?:string}} */
  addFrame(text) {
    let frame
    try {
      frame = JSON.parse(text)
    } catch {
      return { ok: false, error: 'Not a valid transfer frame' }
    }
    if (frame.v !== 1 || typeof frame.i !== 'number' || typeof frame.n !== 'number' || !frame.d) {
      return { ok: false, error: 'Not a valid transfer frame' }
    }

    // If we see a new transfer id mid-scan, reset (assume user started over
    // or is scanning a different transfer).
    if (this.id !== null && frame.id !== this.id) {
      this.reset()
    }

    if (this.id === null) {
      this.id = frame.id
      this.total = frame.n
      this.name = frame.name
      this.size = frame.size
      this.hash = frame.hash
      this.gz = frame.gz
    }

    if (this.chunks.has(frame.i)) {
      return { ok: true, duplicate: true, progress: this.progress() }
    }

    if (this.startTime === null) this.startTime = Date.now()
    const bytes = base64ToBytes(frame.d)
    this.chunks.set(frame.i, bytes)
    this.bytesReceived += bytes.length
    if (this.chunks.size === this.total) this.completeTime = Date.now()
    return { ok: true, duplicate: false, progress: this.progress() }
  }

  progress() {
    const elapsedSeconds = this.startTime ? (Date.now() - this.startTime) / 1000 : 0
    const bytesPerSecond = elapsedSeconds > 0.2 ? this.bytesReceived / elapsedSeconds : 0
    return {
      received: this.chunks.size,
      total: this.total ?? 0,
      bytesReceived: this.bytesReceived,
      elapsedSeconds,
      bytesPerSecond,
    }
  }

  isComplete() {
    return this.total !== null && this.chunks.size === this.total
  }

  missingIndexes() {
    if (this.total === null) return []
    const missing = []
    for (let i = 0; i < this.total; i++) if (!this.chunks.has(i)) missing.push(i)
    return missing
  }

  reset() {
    this.id = null
    this.total = null
    this.name = null
    this.size = null
    this.hash = null
    this.gz = 0
    this.chunks.clear()
  }

  /**
   * Reassemble, decompress, and verify. Throws if checksum mismatches.
   * @returns {Promise<{blob: Blob, name: string}>}
   */
  async finalize() {
    if (!this.isComplete()) throw new Error('Transfer incomplete')

    let total = 0
    for (let i = 0; i < this.total; i++) total += this.chunks.get(i).length
    const combined = new Uint8Array(total)
    let offset = 0
    for (let i = 0; i < this.total; i++) {
      const c = this.chunks.get(i)
      combined.set(c, offset)
      offset += c.length
    }

    let finalBytes = combined
    if (this.gz) {
      finalBytes = pako.ungzip(combined)
    }

    const hash = await sha256Hex(finalBytes)
    if (hash !== this.hash) {
      throw new Error('Checksum mismatch — file is corrupted or a chunk was misread. Try re-scanning.')
    }

    return { blob: new Blob([finalBytes]), name: this.name }
  }
}

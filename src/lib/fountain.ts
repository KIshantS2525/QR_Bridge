// @ts-nocheck
// LT-style fountain coding for the QR optical channel.
//
// Why this exists: the classic indexed-chunk protocol (protocol.ts) has no
// loss recovery — if the receiver misses chunk #37, the ONLY way to get it
// back is to wait for that exact frame to reappear (or scrub back to it by
// hand). Fountain coding fixes that by making every transmitted frame a
// random linear (XOR) combination of source blocks rather than one specific
// block. Any sufficiently large set of *distinct* symbols lets the receiver
// reconstruct the file — there is no "waiting on one specific frame" failure
// mode, because every new frame is fungible.
//
// Frame wire format (v2):
// {
//   v: 2,
//   id: <str>,       transfer id (random per encode, same role as v1)
//   k: <int>,        number of source blocks
//   bs: <int>,       source block size in bytes (last block is zero-padded)
//   cs: <int>,       exact byte length of the (possibly gzipped) payload,
//                    i.e. k*bs minus the last block's padding
//   name, size, hash, gz: same meaning as v1
//   seed: <int>,     32-bit seed identifying this symbol. seed < k means
//                    "systematic" (this symbol IS source block #seed,
//                    unmodified) so a loss-free run behaves exactly like the
//                    old indexed protocol. seed >= k means a random combo
//                    whose degree + participating indices are re-derived
//                    from the seed by BOTH sides via the same PRNG, so we
//                    never have to transmit an index list.
//   d: <base64>      the XOR-combined block, length bs
// }
//
// The encoder just keeps counting seed = 0, 1, 2, ... forever while
// "playing" — there is no end. The decoder runs an online peeling decoder:
// every time a symbol resolves down to a single unknown block, it substitutes
// that block into every other pending symbol that referenced it, which can
// cascade into resolving many blocks from one new frame.

import * as pako from 'pako'

export const DEFAULT_BLOCK_BYTES = 700

// ---------------------------------------------------------------------------
// Deterministic PRNG. Pure 32-bit integer/bitwise arithmetic only, so it
// produces bit-identical output on every JS engine — critical since the
// encoder (screen) and decoder (camera, often a different device) must
// derive the exact same degree + indices from nothing but a shared seed.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0
  return function rand() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Robust soliton degree distribution. This is the standard LT-code degree
// distribution: it mixes the "ideal soliton" (which balances the peeling
// process on average) with an extra bump around degree K/S that guarantees
// (with high probability) a handful of low-degree symbols exist to kick the
// peeling process off and keep it from stalling.
// ---------------------------------------------------------------------------
function robustSolitonCdf(K, c = 0.03, delta = 0.05) {
  const S = Math.max(1, Math.round(c * Math.log(K / delta) * Math.sqrt(K)))
  const rho = new Float64Array(K + 1)
  rho[1] = 1 / K
  for (let i = 2; i <= K; i++) rho[i] = 1 / (i * (i - 1))

  const tau = new Float64Array(K + 1)
  const cutoff = Math.min(K, Math.round(K / S) - 1)
  for (let i = 1; i <= cutoff; i++) tau[i] = S / (K * i)
  if (cutoff + 1 <= K) tau[Math.min(K, Math.round(K / S))] += (S / K) * Math.log(S / delta)

  const mu = new Float64Array(K + 1)
  let z = 0
  for (let i = 1; i <= K; i++) {
    mu[i] = rho[i] + tau[i]
    z += mu[i]
  }
  const cdf = new Float64Array(K + 1)
  let acc = 0
  for (let i = 1; i <= K; i++) {
    acc += mu[i] / z
    cdf[i] = acc
  }
  cdf[K] = 1 // guard against float drift
  return cdf
}

const cdfCache = new Map()
function cdfForK(K) {
  let cdf = cdfCache.get(K)
  if (!cdf) {
    cdf = robustSolitonCdf(K)
    cdfCache.set(K, cdf)
  }
  return cdf
}

function sampleDegree(rand, cdf, K) {
  const x = rand()
  // Small-K CDFs are short; linear scan is plenty fast (K is source-block
  // count, but the CDF array itself has length K+1 — for huge K a binary
  // search would be nicer, so use one past a modest threshold).
  if (K <= 512) {
    for (let d = 1; d <= K; d++) if (x <= cdf[d]) return d
    return K
  }
  let lo = 1
  let hi = K
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (x <= cdf[mid]) hi = mid
    else lo = mid + 1
  }
  return lo
}

/** Sample `degree` distinct indices from [0, K) using rejection sampling
 * (cheap since degree is almost always << K for the robust soliton dist). */
function sampleIndices(rand, K, degree) {
  const d = Math.min(degree, K)
  const chosen = new Set()
  while (chosen.size < d) {
    chosen.add(Math.floor(rand() * K))
  }
  return chosen
}

/** Re-derive the exact set of source-block indices a given seed encodes.
 * Both encoder and decoder call this — it is the only thing that has to
 * stay bit-for-bit identical between them. */
export function indicesForSeed(seed, K) {
  if (seed < K) return new Set([seed]) // systematic pass
  const rand = mulberry32(seed)
  const cdf = cdfForK(K)
  const degree = sampleDegree(rand, cdf, K)
  return sampleIndices(rand, K, degree)
}

function xorInto(dst, src) {
  for (let i = 0; i < dst.length; i++) dst[i] ^= src[i]
}

// FNV-1a 32-bit — fast, dependency-free, plenty for "did this one QR misread
// a byte" detection. This is NOT a security checksum (the final SHA-256 over
// the whole reassembled file still does that job); it exists purely so a
// single corrupted symbol gets thrown away at the door instead of being
// XORed into the belief-propagation graph, where it could otherwise cascade
// and silently corrupt several *other* already-resolved blocks before the
// final hash check ever catches it.
function fnv1a(bytes) {
  let hash = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

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
 * Prepare a file for fountain transmission. Returns a cheap `getFrame(seed)`
 * function instead of a fixed frame array — there IS no fixed frame count,
 * the encoder can emit symbols forever.
 */
export async function encodeFileToFountainSource(file, opts = {}) {
  const { blockBytes = DEFAULT_BLOCK_BYTES, useGzip = true } = opts

  const originalBuf = new Uint8Array(await file.arrayBuffer())
  const hash = await sha256Hex(originalBuf)

  let payload = originalBuf
  let gz = 0
  if (useGzip) {
    const compressed = pako.gzip(originalBuf)
    if (compressed.length < originalBuf.length) {
      payload = compressed
      gz = 1
    }
  }

  const id = randomId()
  const name = file.name || 'file.bin'
  const size = originalBuf.length
  const cs = payload.length

  const K = Math.max(1, Math.ceil(payload.length / blockBytes))
  const blocks = new Array(K)
  for (let i = 0; i < K; i++) {
    const block = new Uint8Array(blockBytes)
    block.set(payload.subarray(i * blockBytes, (i + 1) * blockBytes))
    blocks[i] = block
  }

  // Pre-warm the degree CDF for this K so the first random (non-systematic)
  // frame doesn't pay for it mid-animation.
  cdfForK(K)

  function getFrame(seed) {
    const indices = indicesForSeed(seed, K)
    const data = new Uint8Array(blockBytes)
    for (const idx of indices) xorInto(data, blocks[idx])
    return JSON.stringify({
      v: 2,
      seed,
      id,
      k: K,
      bs: blockBytes,
      cs,
      name,
      size,
      hash,
      gz,
      c: fnv1a(data), // per-symbol checksum, see fnv1a() above
      d: bytesToBase64(data),
    })
  }

  return {
    getFrame,
    meta: { id, name, size, hash, gz, chunkCount: K, compressedSize: cs, blockBytes },
  }
}

/**
 * Receiver-side online peeling decoder. Feed it decoded QR text as it scans;
 * unlike the v1 FrameCollector, a symbol doesn't have to map to one visible
 * block — resolving one symbol can cascade into resolving many blocks at
 * once via belief propagation.
 */
export class FountainCollector {
  id: string | null
  k: number | null
  blockBytes: number | null
  name: string | null
  size: number | null
  hash: string | null
  gz: number
  cs: number | null
  resolved: Map<number, Uint8Array>
  seenSeeds: Set<number>
  waiting: Map<number, { indices: Set<number>; data: Uint8Array }>
  adjacency: Map<number, Set<number>>
  nextSymbolKey: number
  framesSeen: number
  bytesReceived: number
  startTime: number | null
  completeTime: number | null

  constructor() {
    this.id = null
    this.k = null
    this.blockBytes = null
    this.name = null
    this.size = null
    this.hash = null
    this.gz = 0
    this.cs = null

    this.resolved = new Map() // index -> Uint8Array (exactly blockBytes long)
    this.seenSeeds = new Set()
    this.waiting = new Map() // symbolKey -> { indices: Set<number>, data: Uint8Array }
    this.adjacency = new Map() // index -> Set<symbolKey>
    this.nextSymbolKey = 0

    this.framesSeen = 0
    this.bytesReceived = 0
    this.startTime = null
    this.completeTime = null
  }

  reset() {
    this.id = null
    this.k = null
    this.blockBytes = null
    this.name = null
    this.size = null
    this.hash = null
    this.gz = 0
    this.cs = null
    this.resolved.clear()
    this.seenSeeds.clear()
    this.waiting.clear()
    this.adjacency.clear()
    this.nextSymbolKey = 0
    this.framesSeen = 0
    this.bytesReceived = 0
    this.startTime = null
    this.completeTime = null
  }

  _removeSymbol(key) {
    const sym = this.waiting.get(key)
    if (!sym) return
    for (const idx of sym.indices) {
      const adj = this.adjacency.get(idx)
      if (adj) {
        adj.delete(key)
        if (adj.size === 0) this.adjacency.delete(idx)
      }
    }
    this.waiting.delete(key)
  }

  _resolve(idx, data) {
    if (this.resolved.has(idx)) return
    this.resolved.set(idx, data)
    this.bytesReceived += this.blockBytes
    const queue = [idx]
    while (queue.length) {
      const cur = queue.pop()
      const curData = this.resolved.get(cur)
      const affected = this.adjacency.get(cur)
      if (!affected) continue
      // Copy: _removeSymbol mutates adjacency sets while we iterate.
      for (const key of [...affected]) {
        const sym = this.waiting.get(key)
        if (!sym || !sym.indices.has(cur)) continue
        xorInto(sym.data, curData)
        sym.indices.delete(cur)
        this.adjacency.get(cur)?.delete(key)
        if (sym.indices.size === 1) {
          const [remaining] = sym.indices
          this._removeSymbol(key)
          if (!this.resolved.has(remaining)) {
            this.resolved.set(remaining, sym.data)
            this.bytesReceived += this.blockBytes
            queue.push(remaining)
          }
        } else if (sym.indices.size === 0) {
          this._removeSymbol(key)
        }
      }
    }
    if (this.k !== null && this.resolved.size === this.k) this.completeTime = Date.now()
  }

  /** @returns {{ok:boolean, duplicate?:boolean, foreign?:boolean, rejected?:boolean, error?:string, progress?:object}} */
  addFrame(text) {
    let frame
    try {
      frame = JSON.parse(text)
    } catch {
      return { ok: false, error: 'Not a valid transfer frame' }
    }
    if (
      !frame ||
      typeof frame !== 'object' ||
      frame.v !== 2 ||
      typeof frame.seed !== 'number' ||
      typeof frame.k !== 'number' ||
      typeof frame.bs !== 'number' ||
      typeof frame.id !== 'string' ||
      !frame.d
    ) {
      return { ok: false, error: 'Not a valid transfer frame' }
    }

    // A different transfer id showed up. If we have no progress yet, treat
    // it as "starting fresh" (e.g. the user just pointed the camera at a new
    // sender). But if we're mid-transfer, silently wiping accumulated work
    // because a stray unrelated QR drifted through the frame is exactly the
    // kind of surprise data loss worth avoiding — so we just ignore it and
    // tell the caller, rather than reset. The user can still switch senders
    // explicitly via Stop/Start, which calls reset() itself.
    if (this.id !== null && frame.id !== this.id) {
      if (this.resolved.size === 0) {
        this.reset()
      } else {
        return { ok: true, foreign: true, progress: this.progress() }
      }
    }

    if (this.id === null) {
      this.id = frame.id
      this.k = frame.k
      this.blockBytes = frame.bs
      this.cs = frame.cs
      this.name = frame.name
      this.size = frame.size
      this.hash = frame.hash
      this.gz = frame.gz
    }

    if (this.seenSeeds.has(frame.seed)) {
      return { ok: true, duplicate: true, progress: this.progress() }
    }

    // Everything past this point touches base64 decoding and array indexing
    // driven by fields we don't fully control (a misread QR can still pass
    // JSON.parse but contain garbage) — never let a single bad frame throw
    // and kill the whole scanning session.
    try {
      const data = base64ToBytes(frame.d)

      // Per-symbol checksum: reject a corrupted symbol here, before it can
      // get XORed into the belief-propagation graph and cascade into
      // corrupting other, already-resolved blocks. Deliberately NOT added to
      // seenSeeds — a future re-scan of the same seed might read cleanly.
      if (typeof frame.c === 'string' && fnv1a(data) !== frame.c) {
        return { ok: true, rejected: true, progress: this.progress() }
      }

      if (this.startTime === null) this.startTime = Date.now()
      this.seenSeeds.add(frame.seed)
      this.framesSeen++

      const indices = indicesForSeed(frame.seed, this.k)
      const remaining = new Set()
      for (const idx of indices) {
        if (this.resolved.has(idx)) xorInto(data, this.resolved.get(idx))
        else remaining.add(idx)
      }

      if (remaining.size === 0) {
        return { ok: true, duplicate: true, progress: this.progress() } // fully redundant
      }
      if (remaining.size === 1) {
        const [idx] = remaining
        this._resolve(idx, data)
      } else {
        const key = this.nextSymbolKey++
        this.waiting.set(key, { indices: remaining, data })
        for (const idx of remaining) {
          let adj = this.adjacency.get(idx)
          if (!adj) {
            adj = new Set()
            this.adjacency.set(idx, adj)
          }
          adj.add(key)
        }
      }

      return { ok: true, duplicate: false, progress: this.progress() }
    } catch {
      // Malformed base64, out-of-range indices, whatever — treat it the same
      // as a rejected checksum: drop this one frame, keep scanning.
      return { ok: true, rejected: true, progress: this.progress() }
    }
  }

  progress() {
    const elapsedSeconds = this.startTime ? (Date.now() - this.startTime) / 1000 : 0
    const bytesPerSecond = elapsedSeconds > 0.2 ? this.bytesReceived / elapsedSeconds : 0
    return {
      received: this.resolved.size,
      total: this.k ?? 0,
      framesSeen: this.framesSeen,
      bytesReceived: this.bytesReceived,
      elapsedSeconds,
      bytesPerSecond,
    }
  }

  isComplete() {
    return this.k !== null && this.resolved.size === this.k
  }

  async finalize() {
    if (!this.isComplete()) throw new Error('Transfer incomplete')

    const combined = new Uint8Array(this.k * this.blockBytes)
    for (let i = 0; i < this.k; i++) combined.set(this.resolved.get(i), i * this.blockBytes)
    const trimmed = combined.subarray(0, this.cs ?? combined.length)

    let finalBytes = trimmed
    if (this.gz) finalBytes = pako.ungzip(trimmed)

    const hash = await sha256Hex(finalBytes)
    if (hash !== this.hash) {
      throw new Error('Checksum mismatch — file is corrupted or a chunk was misread. Try re-scanning.')
    }

    return { blob: new Blob([finalBytes]), name: this.name }
  }
}

// @ts-nocheck
import { describe, expect, it } from 'vitest'
import { encodeFileToFountainSource, FountainCollector, base64ToBytes, bytesToBase64 } from './fountain'

// Minimal File-like shim — encodeFileToFountainSource only calls
// .arrayBuffer() and reads .name, so we don't need a real File/Blob.
function makeFile(bytes, name = 'test.bin') {
  return {
    name,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
  }
}

function randomBytes(n) {
  const bytes = new Uint8Array(n)
  crypto.getRandomValues(bytes.subarray(0, Math.min(n, 65536)))
  // crypto.getRandomValues has a 65536-byte-per-call limit in some engines
  for (let offset = 65536; offset < n; offset += 65536) {
    crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65536, n)))
  }
  return bytes
}

async function roundTrip({ size, lossRate, blockBytes = 700, maxFramesMultiplier = 40 }) {
  const original = randomBytes(size)
  const file = makeFile(original)
  const { getFrame, meta } = await encodeFileToFountainSource(file, { blockBytes })

  const collector = new FountainCollector()
  let seed = 0
  let framesSent = 0
  const maxFrames = meta.chunkCount * maxFramesMultiplier + 1000
  while (!collector.isComplete() && framesSent < maxFrames) {
    const frame = getFrame(seed)
    seed++
    framesSent++
    if (Math.random() < lossRate) continue
    collector.addFrame(frame)
  }

  if (!collector.isComplete()) return { completed: false, framesSent, meta }

  const { blob } = await collector.finalize()
  const resultBytes = new Uint8Array(await blob.arrayBuffer())
  const matches =
    resultBytes.length === original.length && resultBytes.every((b, i) => b === original[i])

  return { completed: true, matches, framesSent, meta }
}

describe('fountain codec round trip', () => {
  const cases = [
    { label: 'empty file, no loss', size: 0, lossRate: 0 },
    { label: 'tiny file, no loss', size: 500, lossRate: 0 },
    { label: 'tiny file, 30% loss', size: 500, lossRate: 0.3 },
    { label: 'small file, no loss', size: 20_000, lossRate: 0 },
    { label: 'small file, 20% loss', size: 20_000, lossRate: 0.2 },
    { label: 'small file, 50% loss', size: 20_000, lossRate: 0.5 },
    { label: 'medium file, 30% loss', size: 200_000, lossRate: 0.3 },
    { label: 'single block, 80% loss', size: 100, lossRate: 0.8 },
  ]

  for (const { label, size, lossRate } of cases) {
    it(`reconstructs byte-for-byte: ${label}`, async () => {
      const result = await roundTrip({ size, lossRate })
      expect(result.completed).toBe(true)
      expect(result.matches).toBe(true)
    })
  }

  it('does not need drastically more frames than the source-block count even under loss', async () => {
    // A regression guard, not a tight bound: if someone breaks the degree
    // distribution and overhead balloons, this should catch it long before
    // it becomes a "why is this transfer taking forever" bug report.
    const result = await roundTrip({ size: 200_000, lossRate: 0.3 })
    const overhead = result.framesSent / result.meta.chunkCount - 1
    expect(overhead).toBeLessThan(3) // generous — real overhead is typically ~1x at 30% loss
  })
})

describe('FountainCollector robustness', () => {
  it('never throws on garbage input', () => {
    const collector = new FountainCollector()
    const garbageInputs = [
      'not json at all',
      '{}',
      '{"v":2}',
      '{"v":2,"seed":0,"k":10,"bs":700,"id":"abc","d":"!!!not-base64!!!"}',
      '{"v":1,"seed":0,"k":10,"bs":700,"id":"abc","d":"AAAA"}', // wrong version
      JSON.stringify({ v: 2, seed: 'nope', k: 10, bs: 700, id: 'abc', d: 'AAAA' }),
      '',
      'null',
      '12345',
    ]
    for (const input of garbageInputs) {
      expect(() => collector.addFrame(input)).not.toThrow()
    }
  })

  it('rejects a frame whose per-symbol checksum does not match, without corrupting state', async () => {
    const original = randomBytes(5000)
    const { getFrame, meta } = await encodeFileToFountainSource(makeFile(original), { blockBytes: 700 })
    const collector = new FountainCollector()

    // Corrupt one byte of the base64 payload on an otherwise-valid frame.
    const goodFrame = JSON.parse(getFrame(0))
    const bytes = base64ToBytes(goodFrame.d)
    bytes[0] ^= 0xff // flip bits — simulates a camera misread
    const corrupted = { ...goodFrame, d: bytesToBase64(bytes) }

    const status = collector.addFrame(JSON.stringify(corrupted))
    expect(status.ok).toBe(true)
    expect(status.rejected).toBe(true)
    expect(collector.resolved.size).toBe(0) // nothing should have been accepted into the graph

    // The same seed, read cleanly this time, should still work — corrupted
    // reads must not get permanently blacklisted by seed.
    const cleanStatus = collector.addFrame(getFrame(0))
    expect(cleanStatus.ok).toBe(true)
    expect(cleanStatus.rejected).toBeFalsy()
  })

  it('ignores frames from a different transfer once progress has been made, instead of silently resetting', async () => {
    const fileA = makeFile(randomBytes(5000), 'a.bin')
    const fileB = makeFile(randomBytes(5000), 'b.bin')
    const sourceA = await encodeFileToFountainSource(fileA, { blockBytes: 700 })
    const sourceB = await encodeFileToFountainSource(fileB, { blockBytes: 700 })

    const collector = new FountainCollector()
    collector.addFrame(sourceA.getFrame(0)) // establish transfer A, make some progress
    expect(collector.resolved.size).toBeGreaterThan(0)
    const progressBefore = collector.resolved.size

    const status = collector.addFrame(sourceB.getFrame(0)) // stray frame from an unrelated transfer
    expect(status.foreign).toBe(true)
    expect(collector.resolved.size).toBe(progressBefore) // untouched, not reset

    // Transfer A should still be able to complete normally afterwards.
    let seed = 1
    while (!collector.isComplete() && seed < sourceA.meta.chunkCount * 5) {
      collector.addFrame(sourceA.getFrame(seed))
      seed++
    }
    expect(collector.isComplete()).toBe(true)
  })

  it('does adopt a new transfer id when no progress has been made yet', async () => {
    const fileA = makeFile(randomBytes(5000), 'a.bin')
    const fileB = makeFile(randomBytes(5000), 'b.bin')
    const sourceA = await encodeFileToFountainSource(fileA, { blockBytes: 700 })
    const sourceB = await encodeFileToFountainSource(fileB, { blockBytes: 700 })

    const collector = new FountainCollector()
    collector.id = sourceA.meta.id // pretend we saw transfer A's header but no blocks resolved yet
    collector.k = sourceA.meta.chunkCount

    const status = collector.addFrame(sourceB.getFrame(0))
    expect(status.foreign).toBeFalsy()
    expect(collector.id).toBe(sourceB.meta.id)
  })
})

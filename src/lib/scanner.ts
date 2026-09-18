// @ts-nocheck
import jsQR from 'jsqr'

export function hasNativeBarcodeDetector() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
}

/**
 * Starts scanning a <video> element for QR codes and calls onDecode(text)
 * for every successfully decoded frame (duplicates included - the caller
 * dedupes). Returns a stop() function.
 */
export async function startScanning(videoEl, canvasEl, onDecode, onError) {
  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    })
  } catch (err) {
    onError?.(new Error('Camera access denied or unavailable: ' + err.message))
    return () => {}
  }

  videoEl.srcObject = stream
  await videoEl.play()

  const ctx = canvasEl.getContext('2d', { willReadFrequently: true })
  let running = true

  const detector = hasNativeBarcodeDetector() ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null

  async function tick() {
    if (!running) return
    if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
      canvasEl.width = videoEl.videoWidth
      canvasEl.height = videoEl.videoHeight
      ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height)

      try {
        if (detector) {
          const codes = await detector.detect(canvasEl)
          for (const c of codes) if (c.rawValue) onDecode(c.rawValue)
        } else {
          const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height)
          const result = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          })
          if (result?.data) onDecode(result.data)
        }
      } catch (err) {
        // Non-fatal per-frame decode errors are expected (blur, no code in frame)
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  return function stop() {
    running = false
    stream.getTracks().forEach((t) => t.stop())
  }
}

/** Decode a single still image (e.g. an uploaded photo of a QR code). */
export async function decodeImageFile(file) {
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)

  if (hasNativeBarcodeDetector()) {
    const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
    const codes = await detector.detect(canvas)
    if (codes[0]?.rawValue) return codes[0].rawValue
  }
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const result = jsQR(imageData.data, imageData.width, imageData.height)
  if (result?.data) return result.data
  throw new Error('No QR code found in image')
}

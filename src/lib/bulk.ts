// @ts-nocheck
import JSZip from 'jszip'

/**
 * Turn a FileList/array of Files into a single transferable File.
 * - 1 file -> returned as-is (no double compression, no zip overhead)
 * - 2+ files -> zipped into one "bundle.zip" File
 */
export async function prepareBulkPayload(files, onProgress) {
  const list = Array.from(files)
  if (list.length === 0) throw new Error('No files selected')
  if (list.length === 1) return { file: list[0], isBundle: false, fileCount: 1 }

  const zip = new JSZip()
  for (const f of list) {
    // webkitRelativePath preserves folder structure when the user drops a folder
    const path = f.webkitRelativePath || f.name
    zip.file(path, f)
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, (meta) => {
    onProgress?.(meta.percent)
  })

  const name = `bundle_${list.length}files.zip`
  const bundleFile = new File([blob], name, { type: 'application/zip' })
  return { file: bundleFile, isBundle: true, fileCount: list.length }
}

/**
 * After a bulk transfer is received, unzip it back into individual files.
 * @returns {Promise<{name: string, blob: Blob}[]>}
 */
export async function unpackBulkPayload(blob) {
  const zip = await JSZip.loadAsync(blob)
  const entries = Object.values(zip.files).filter((e) => !e.dir)
  const out = []
  for (const entry of entries) {
    const content = await entry.async('blob')
    out.push({ name: entry.name, blob: content })
  }
  return out
}

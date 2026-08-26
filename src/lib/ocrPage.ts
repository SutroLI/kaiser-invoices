type OcrWord = {
  text?: string
  bbox?: { x0: number; y0: number; x1: number; y1: number }
}

import type { PreprocessMode } from '../types'

type OcrWorker = {
  setParameters: (params: Record<string, string>) => Promise<unknown>
  recognize: (image: Blob) => Promise<{
    data: {
      text?: string
      confidence?: number
      words?: OcrWord[]
      lines?: Array<{ text?: string; words?: OcrWord[] }>
    }
  }>
  terminate: () => Promise<unknown>
}

let workerPromise: Promise<OcrWorker> | null = null

function ocrAssetUrl(file: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  return new URL(`${base}ocr/${file}`, window.location.origin).href
}

async function getWorker(): Promise<OcrWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const tesseract = await import('tesseract.js')
      const createWorker =
        tesseract.createWorker ??
        (tesseract as { default?: { createWorker?: typeof tesseract.createWorker } }).default
          ?.createWorker
      if (!createWorker) throw new Error('tesseract.js createWorker is unavailable')

      const worker = await createWorker('eng', 1, {
        workerPath: ocrAssetUrl('worker.min.js'),
        corePath: ocrAssetUrl('tesseract-core-simd-lstm.wasm.js'),
        langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int',
        workerBlobURL: false,
      })
      await (worker as OcrWorker).setParameters({
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1',
      })
      return worker as OcrWorker
    })().catch((err) => {
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

/**
 * Encode a canvas without HTMLCanvasElement.toBlob.
 * Chrome often never fires that callback while the tab is in the background.
 */
async function canvasToOcrImage(canvas: HTMLCanvasElement): Promise<Blob> {
  try {
    if (typeof OffscreenCanvas !== 'undefined') {
      const src = canvas.getContext('2d')
      if (src) {
        const off = new OffscreenCanvas(canvas.width, canvas.height)
        const ctx = off.getContext('2d')
        if (ctx && typeof off.convertToBlob === 'function') {
          ctx.putImageData(src.getImageData(0, 0, canvas.width, canvas.height), 0, 0)
          return await off.convertToBlob({ type: 'image/png' })
        }
      }
    }
  } catch {
    // Fall through to a synchronous PNG encode.
  }
  const dataUrl = canvas.toDataURL('image/png')
  const comma = dataUrl.indexOf(',')
  const bin = atob(comma >= 0 ? dataUrl.slice(comma + 1) : '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'image/png' })
}

async function recognizeCanvas(canvas: HTMLCanvasElement) {
  const worker = await getWorker()
  return worker.recognize(await canvasToOcrImage(canvas))
}

export async function terminateOcrWorker(): Promise<void> {
  if (!workerPromise) return
  try {
    const worker = await workerPromise
    await worker.terminate()
  } catch {
    // Worker never started.
  }
  workerPromise = null
}

export function canvasInkRatio(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d')
  if (!ctx) return 0
  return inkRatio(ctx.getImageData(0, 0, canvas.width, canvas.height).data)
}

function inkRatio(data: Uint8ClampedArray): number {
  let dark = 0
  const step = 16 * 4
  let n = 0
  for (let i = 0; i < data.length; i += step) {
    n += 1
    if ((data[i] + data[i + 1] + data[i + 2]) / 3 < 210) dark += 1
  }
  return n === 0 ? 0 : dark / n
}

/**
 * Lightweight prep. Default contrast keeps thin commas and $ signs;
 * binary is optional for debug comparison; raw skips all filters.
 */
export function preprocessForOcr(
  canvas: HTMLCanvasElement,
  mode: PreprocessMode = 'contrast',
): HTMLCanvasElement {
  if (mode === 'raw') return canvas
  const src = canvas.getContext('2d')
  if (!src) return canvas
  const { width, height } = canvas
  const img = src.getImageData(0, 0, width, height)
  const px = img.data

  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
    let v: number
    if (mode === 'binary') {
      v = g < 168 ? 0 : 255
    } else {
      v = g > 200 ? 255 : g < 140 ? 0 : g
    }
    px[i] = px[i + 1] = px[i + 2] = v
  }

  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d')
  if (!ctx) return canvas
  ctx.putImageData(img, 0, 0)
  return out
}

export function cropCanvas(
  src: HTMLCanvasElement,
  left: number,
  top: number,
  right: number,
  bottom: number,
): HTMLCanvasElement {
  const w = Math.max(1, Math.floor(right - left))
  const h = Math.max(1, Math.floor(bottom - top))
  const dst = document.createElement('canvas')
  dst.width = w
  dst.height = h
  const ctx = dst.getContext('2d')
  if (!ctx) return src
  ctx.drawImage(src, left, top, w, h, 0, 0, w, h)
  return dst
}

export function cropRect(
  src: HTMLCanvasElement,
  box: { x: number; y: number; w: number; h: number },
): HTMLCanvasElement {
  return cropCanvas(src, box.x, box.y, box.x + box.w, box.y + box.h)
}

export function downscaleCanvas(src: HTMLCanvasElement, maxWidth = 1100): HTMLCanvasElement {
  if (src.width <= maxWidth) return src
  const scale = maxWidth / src.width
  const dst = document.createElement('canvas')
  dst.width = Math.max(1, Math.round(src.width * scale))
  dst.height = Math.max(1, Math.round(src.height * scale))
  const ctx = dst.getContext('2d')
  if (!ctx) return src
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(src, 0, 0, dst.width, dst.height)
  return dst
}

const NAME_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-.,"
const AMOUNT_WHITELIST = '0123456789.,-$()'
const LOCATE_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$',.-/ "

export async function recognizeField(
  image: HTMLCanvasElement,
  kind: 'name' | 'amount' | 'line' | 'locate',
  preprocess: PreprocessMode = 'contrast',
): Promise<{ text: string; confidence: number | null }> {
  const worker = await getWorker()
  const psm = kind === 'amount' ? '7' : kind === 'name' || kind === 'line' ? '7' : '6'
  const whitelist =
    kind === 'amount' ? AMOUNT_WHITELIST : kind === 'name' ? NAME_WHITELIST : LOCATE_WHITELIST
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    tessedit_char_whitelist: whitelist,
    preserve_interword_spaces: '1',
  })
  const prepared = preprocessForOcr(image, preprocess)
  const result = await recognizeCanvas(prepared)
  const text = (result.data.text ?? '').replace(/\s+/g, ' ').trim()
  const confidence =
    typeof result.data.confidence === 'number' && Number.isFinite(result.data.confidence)
      ? result.data.confidence
      : null
  return { text, confidence }
}

export function zipOcrColumns(leftText: string, rightText: string): string {
  const left = leftText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 2)
  const right = rightText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /\$|[\d,]+\.\d{2}|\d{3,}/.test(l))
  if (left.length === 0) return ''
  const len = Math.max(left.length, right.length)
  const close =
    right.length > 0 &&
    Math.abs(left.length - right.length) <= Math.max(4, Math.floor(Math.max(left.length, right.length) * 0.4))
  if (!close) {
    let ri = 0
    return left
      .map((row) => {
        if (ri < right.length && /[A-Za-z]{4,}/.test(row)) return `${row} ${right[ri++]}`
        return row
      })
      .join('\n')
  }
  const lines: string[] = []
  for (let i = 0; i < len; i++) {
    lines.push(`${left[i] ?? ''} ${right[i] ?? ''}`.trim())
  }
  return lines.join('\n')
}

/** Drop letterhead / footer so Tesseract only sees the membership grid. */
export function cropMembershipTable(
  src: HTMLCanvasElement,
  kind: 'main' | 'overflow' = 'main',
): HTMLCanvasElement {
  const w = src.width
  const h = src.height
  if (kind === 'overflow') {
    // Keep almost the full page. A short crop (to ~62%) dropped the second half of
    // June's grid when locate only saw the first few names and called it overflow.
    return cropCanvas(src, 0, h * 0.03, w, h * 0.985)
  }
  // Keep the first/last grid rows — 15%/6% crops were dropping Buckley/Cone/Winfield.
  return cropCanvas(src, w * 0.008, h * 0.08, w * 0.992, h * 0.985)
}

/** Horizontal slices of a table crop. Overlap so a row split across a cut is still read. */
export function bandRanges(
  height: number,
  bandCount: number,
  overlap = 0.22,
): Array<{ top: number; bottom: number }> {
  const count = Math.max(1, bandCount)
  const step = 1 / count
  const ranges: Array<{ top: number; bottom: number }> = []
  for (let i = 0; i < count; i++) {
    const pad = overlap * step
    const top = Math.max(0, (i * step - (i === 0 ? 0 : pad)) * height)
    const bottom = Math.min(height, ((i + 1) * step + (i === count - 1 ? 0 : pad)) * height)
    ranges.push({ top, bottom })
  }
  return ranges
}

export function splitTableBands(
  src: HTMLCanvasElement,
  bandCount: number,
): HTMLCanvasElement[] {
  return bandRanges(src.height, bandCount).map(({ top, bottom }) =>
    cropCanvas(src, 0, top, src.width, bottom),
  )
}

export type OcrMode = 'locate' | 'table'

function mergeOcrBlobs(...blobs: string[]): string {
  return blobs.filter((b) => b.trim()).join('\n')
}

function rotateCanvas(src: HTMLCanvasElement, degrees: number): HTMLCanvasElement {
  const rot = ((degrees % 360) + 360) % 360
  if (rot === 0) return src
  const rad = (rot * Math.PI) / 180
  const swap = rot === 90 || rot === 270
  const dst = document.createElement('canvas')
  dst.width = swap ? src.height : src.width
  dst.height = swap ? src.width : src.height
  const ctx = dst.getContext('2d')
  if (!ctx) return src
  ctx.translate(dst.width / 2, dst.height / 2)
  ctx.rotate(rad)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return dst
}

function ocrLooksUseful(text: string): boolean {
  return /Membership Detail for Group ID|Family Count|Medical current charge/i.test(text)
}

function looksLikeReadablePage(text: string): boolean {
  const letters = (text.match(/[A-Za-z]/g) ?? []).length
  const words = (text.match(/[A-Za-z]{4,}/g) ?? []).length
  return letters >= 120 && words >= 8
}

/** Cover/summary pages that are already upright — don't spend 3 more OCR passes. */
export function shouldTryMoreOrientations(text: string): boolean {
  if (ocrLooksUseful(text)) return false
  if (
    looksLikeReadablePage(text) &&
    /Consolidated Billing|Payment Summary|About Your Bill|Please pay this Amount|Total Amount Due|Medical Plan Legend/i.test(
      text,
    )
  ) {
    return false
  }
  return true
}

/** Rebuild left-to-right table rows from word boxes so cells stay on one line. */
export function linesFromOcrWords(words: OcrWord[]): string {
  const usable = words
    .map((w) => ({
      text: (w.text ?? '').trim(),
      x: w.bbox?.x0 ?? 0,
      y: ((w.bbox?.y0 ?? 0) + (w.bbox?.y1 ?? 0)) / 2,
      h: Math.max(1, (w.bbox?.y1 ?? 0) - (w.bbox?.y0 ?? 0)),
    }))
    .filter((w) => w.text)

  if (usable.length === 0) return ''

  usable.sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: typeof usable[] = []
  for (const word of usable) {
    const last = rows[rows.length - 1]
    if (!last) {
      rows.push([word])
      continue
    }
    const avgY = last.reduce((s, w) => s + w.y, 0) / last.length
    const avgH = last.reduce((s, w) => s + w.h, 0) / last.length
    if (Math.abs(word.y - avgY) <= Math.max(avgH, 10) * 0.7) last.push(word)
    else rows.push([word])
  }

  return rows
    .map((row) =>
      row
        .sort((a, b) => a.x - b.x)
        .map((w) => w.text)
        .join(' '),
    )
    .join('\n')
}

function ocrScore(text: string): number {
  if (!text.trim()) return -1
  const money =
    (text.match(/\$[\d,]*\.\d{2}/g) ?? []).length + (text.match(/\$\d{3,}/g) ?? []).length
  const header = /Membership Detail/i.test(text) ? 100 : 0
  const names = (text.match(/[A-Z]{4,}\s*,\s*[A-Z]{3,}/g) ?? []).length
  return header + money * 4 + names * 3
}

export function textFromRecognizeData(data: {
  text?: string
  words?: OcrWord[]
  lines?: Array<{ text?: string; words?: OcrWord[] }>
}): string {
  const fromWords = data.words?.length ? linesFromOcrWords(data.words) : ''
  const fromLines = (data.lines ?? [])
    .map((l) => l.text?.trim())
    .filter(Boolean)
    .join('\n')
  const ranked = [data.text ?? '', fromWords, fromLines]
    .map((text, i) => ({ text, score: ocrScore(text), i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
  return ranked[0]?.text || data.text || ''
}

export type OcrWordBox = {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

function wordsFromRecognize(data: { words?: OcrWord[] }, yOffset = 0): OcrWordBox[] {
  return (data.words ?? [])
    .map((w) => ({
      text: (w.text ?? '').trim(),
      x0: w.bbox?.x0 ?? 0,
      y0: (w.bbox?.y0 ?? 0) + yOffset,
      x1: w.bbox?.x1 ?? 0,
      y1: (w.bbox?.y1 ?? 0) + yOffset,
    }))
    .filter((w) => w.text)
}

export async function ocrMembershipTable(
  canvas: HTMLCanvasElement,
  onProgress?: (message: string) => void,
  tableKind: 'main' | 'overflow' = 'main',
): Promise<{ text: string; words: OcrWordBox[]; tableCanvas: HTMLCanvasElement }> {
  const ctx = canvas.getContext('2d')
  const empty = {
    text: '',
    words: [] as OcrWordBox[],
    tableCanvas: canvas,
  }
  if (!ctx) return empty
  const sample = ctx.getImageData(0, 0, canvas.width, canvas.height)
  if (inkRatio(sample.data) < 0.004) return empty

  const tableCanvas = cropMembershipTable(canvas, tableKind)
  const worker = await getWorker()
  await worker.setParameters({
    tessedit_pageseg_mode: '6',
    tessedit_char_whitelist: LOCATE_WHITELIST,
    preserve_interword_spaces: '1',
  })

  const shortPage = tableCanvas.height < tableCanvas.width * 0.55
  const count = shortPage ? 3 : 6
  const ranges = bandRanges(tableCanvas.height, count)
  const bands = splitTableBands(tableCanvas, count)
  const parts: string[] = []
  const words: OcrWordBox[] = []
  for (let i = 0; i < bands.length; i++) {
    onProgress?.(`reading table rows ${i + 1} of ${bands.length}`)
    const prepared = preprocessForOcr(bands[i])
    const result = await recognizeCanvas(prepared)
    parts.push(textFromRecognizeData(result.data))
    words.push(...wordsFromRecognize(result.data, ranges[i].top))
  }
  return { text: mergeOcrBlobs(...parts), words, tableCanvas }
}

export async function ocrCanvas(
  canvas: HTMLCanvasElement,
  onProgress?: (message: string) => void,
  options?: { mode?: OcrMode; tableKind?: 'main' | 'overflow' },
): Promise<string> {
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const sample = ctx.getImageData(0, 0, canvas.width, canvas.height)
  if (inkRatio(sample.data) < 0.004) return ''

  const mode = options?.mode ?? 'table'
  if (mode === 'table') {
    onProgress?.('reading membership table')
    const { text } = await ocrMembershipTable(canvas, onProgress, options?.tableKind ?? 'main')
    return text
  }

  const worker = await getWorker()
  await worker.setParameters({
    tessedit_pageseg_mode: '6',
    tessedit_char_whitelist: LOCATE_WHITELIST,
    preserve_interword_spaces: '1',
  })
  const recognizeImage = async (img: HTMLCanvasElement): Promise<string> => {
    const prepared = preprocessForOcr(img)
    const result = await recognizeCanvas(prepared)
    return textFromRecognizeData(result.data)
  }

  onProgress?.('looking for Membership Detail')
  let best = await recognizeImage(canvas)
  let bestScore = ocrScore(best)
  if (!shouldTryMoreOrientations(best)) return best

  for (const deg of [90, 270, 180]) {
    onProgress?.(`trying ${deg}° orientation`)
    const rotated = rotateCanvas(canvas, deg)
    const text = await recognizeImage(rotated)
    const score = ocrScore(text)
    if (score > bestScore) {
      best = text
      bestScore = score
    }
    if (ocrLooksUseful(text)) return text
  }

  return best
}

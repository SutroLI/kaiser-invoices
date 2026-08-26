import type { PaddleOcrResult } from 'ppu-paddle-ocr/web'
import { glueSpacedMoney } from './parseMembershipText'

export type PaddleWordBox = {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

type PaddleService = {
  initialize: () => Promise<void>
  recognize: (image: HTMLCanvasElement) => Promise<PaddleOcrResult>
  destroy: () => Promise<void>
}

const ORT_WASM_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/'

let servicePromise: Promise<PaddleService> | null = null

export function wordsFromPaddle(result: PaddleOcrResult): PaddleWordBox[] {
  return result.lines
    .flat()
    .map((item) => ({
      text: item.text.trim(),
      x0: item.box.x,
      y0: item.box.y,
      x1: item.box.x + item.box.width,
      y1: item.box.y + item.box.height,
    }))
    .filter((w) => w.text)
}

export function textFromPaddle(result: PaddleOcrResult): string {
  const fromLines = result.lines
    .map((line) =>
      line
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean)
    .join('\n')
  return normalizePaddleTableText(fromLines || result.text || '')
}

/** Paddle often inserts spaces inside money and around commas: `$783 .00`, `HOUGHTON , DAPHNE`. */
export function normalizePaddleTableText(text: string): string {
  return glueSpacedMoney(text)
    .replace(/\s+,/g, ',')
    .replace(/,(?=[A-Za-z])/g, ', ')
}

export function paddleLooksUseful(text: string): boolean {
  return /[A-Z]{4,}\s*,\s*[A-Z]|\$[\d,]+\.\d{2}/.test(text)
}

export async function getPaddleService(onProgress?: (message: string) => void): Promise<PaddleService> {
  if (!servicePromise) {
    servicePromise = (async () => {
      onProgress?.('loading PaddleOCR models (first visit downloads them)')
      const ort = await import('onnxruntime-web')
      ort.env.wasm.wasmPaths = ORT_WASM_CDN
      ort.env.wasm.numThreads = 1

      const { PaddleOcrService, V5_EN_MOBILE_MODEL } = await import('ppu-paddle-ocr/web')
      const service = new PaddleOcrService({
        model: V5_EN_MOBILE_MODEL,
        processing: { engine: 'canvas-native' },
        session: { executionProviders: ['wasm'] },
        recognition: {
          spaceRecovery: true,
          strategy: 'per-line',
          charactersDictionary: [],
        } as import('ppu-paddle-ocr/web').RecognitionOptions,
      })
      await service.initialize()
      return service as PaddleService
    })().catch((err) => {
      servicePromise = null
      throw err
    })
  }
  return servicePromise
}

export async function terminatePaddleOcr(): Promise<void> {
  if (!servicePromise) return
  try {
    const service = await servicePromise
    await service.destroy()
  } catch {
    // never started
  }
  servicePromise = null
}

export async function paddleOcrCanvas(
  canvas: HTMLCanvasElement,
  onProgress?: (message: string) => void,
): Promise<{ text: string; words: PaddleWordBox[] }> {
  const service = await getPaddleService(onProgress)
  onProgress?.('reading table with PaddleOCR')
  const result = await service.recognize(canvas)
  return { text: textFromPaddle(result), words: wordsFromPaddle(result) }
}

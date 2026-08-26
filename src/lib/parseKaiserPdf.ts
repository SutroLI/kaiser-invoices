import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { PreprocessMode, ProcessedKaiserInvoice } from '../types'
import { canvasInkRatio, cropRect, ocrCanvas, ocrMembershipTable, recognizeField, terminateOcrWorker, type OcrWordBox } from './ocrPage'
import {
  emptyMeta,
  hydrateMemberRow,
  isLegendText,
  looksLikeFullMembershipTable,
  looksLikeOverflowMembershipPage,
  mergeMemberLists,
  mergeMeta,
  parseInvoiceMeta,
  parseMembershipRows,
} from './parseMembershipText'
import {
  applyMemberRoster,
  fillMissingFromLeftover,
  ignoredOcrWarning,
  isMissingOnInvoice,
  leftoverOcrAfterFill,
  unusedOcrRows,
} from './matchRoster'
import {
  findNameHint,
  memberFromRetryText,
  retryCrops,
  rowStripRect,
  type NameHint,
} from './retryMissingMembers'
import { textItemsToLines } from './textItemsToLines'

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

const TEXT_LETTER_THRESHOLD = 80
const BLANK_INK_RATIO = 0.004
const LOCATE_SCALE = 1.35
const TABLE_SCALE = 3.2

function publicDirUrl(dir: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`
  return new URL(`${base}${dir}/`, window.location.origin).href
}

export type ProgressFn = (message: string) => void

export type ParseKaiserOptions = {
  debug?: boolean
  preprocess?: PreprocessMode
  roster?: string[]
}

async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent()
  return textItemsToLines(content.items)
}

async function renderPage(
  page: PDFPageProxy,
  scale: number,
  rotation?: number,
): Promise<HTMLCanvasElement> {
  const viewport =
    rotation == null
      ? page.getViewport({ scale })
      : page.getViewport({ scale, rotation })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create canvas for OCR')
  await page.render({ canvasContext: ctx, viewport, canvas }).promise
  return canvas
}

function ocrRenderRotation(page: PDFPageProxy): number | undefined {
  if (page.rotate === 90 || page.rotate === 270) return 0
  return undefined
}

function fallbackTablePages(pageCount: number): number[] {
  const guess = new Set<number>()
  for (const n of [3, 4, pageCount - 3, pageCount - 2, pageCount - 1]) {
    if (n >= 1 && n <= pageCount) guess.add(n)
  }
  return [...guess].sort((a, b) => a - b)
}

export async function parseKaiserPdf(
  file: File,
  onProgress?: ProgressFn,
  options?: ParseKaiserOptions,
): Promise<ProcessedKaiserInvoice> {
  const preprocess: PreprocessMode = options?.preprocess ?? 'contrast'
  const buffer = await file.arrayBuffer()
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    wasmUrl: publicDirUrl('pdfjs-wasm'),
  })
  const pdf = await loadingTask.promise
  const pageCount = pdf.numPages

  const result: ProcessedKaiserInvoice = {
    fileName: file.name,
    meta: emptyMeta(),
    members: [],
    pageCount,
    membershipPages: [],
    usedOcr: false,
    errors: [],
    warnings: [],
    debugPages: [],
    completeness: null,
    preprocess,
    unmatchedOcr: [],
  }

  try {
    const fullTablePages = new Set<number>()
    const overflowPages = new Set<number>()
    const legendPages = new Set<number>()

    for (let n = 1; n <= pageCount; n++) {
      onProgress?.(
        n === 1
          ? `Finding Membership Detail in ${file.name} — page 1 of ${pageCount} (language pack on first page)`
          : `Finding Membership Detail in ${file.name} — page ${n} of ${pageCount}`,
      )
      const page = await pdf.getPage(n)
      let text = await pageText(page)

      if ((text.match(/[A-Za-z]/g) ?? []).length < TEXT_LETTER_THRESHOLD) {
        try {
          const canvas = await renderPage(page, LOCATE_SCALE, ocrRenderRotation(page))
          if (canvasInkRatio(canvas) < BLANK_INK_RATIO) {
            result.warnings.push(
              `Page ${n} rendered blank — the scanned image did not decode.`,
            )
          } else {
            const ocr = await ocrCanvas(
              canvas,
              (step) =>
                onProgress?.(
                  `Finding Membership Detail — page ${n} of ${pageCount} (${step})`,
                ),
              { mode: 'locate' },
            )
            if (ocr.trim()) {
              text = ocr
              result.usedOcr = true
            }
          }
        } catch (err) {
          result.warnings.push(
            `OCR failed on page ${n}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }

      result.meta = mergeMeta(result.meta, parseInvoiceMeta(text))
      if (isLegendText(text)) {
        legendPages.add(n)
        continue
      }
      if (looksLikeFullMembershipTable(text)) fullTablePages.add(n)
      else if (looksLikeOverflowMembershipPage(text)) overflowPages.add(n)
    }

    const targets = new Set<number>()
    for (const n of fullTablePages) {
      targets.add(n)
      if (n + 1 <= pageCount && !legendPages.has(n + 1)) targets.add(n + 1)
    }
    for (const n of overflowPages) {
      targets.add(n)
      if (n > 1 && !legendPages.has(n - 1)) targets.add(n - 1)
    }
    if (targets.size === 0) {
      result.warnings.push(
        'Quick scan did not find a Membership Detail heading — reading the usual table pages.',
      )
      for (const n of fallbackTablePages(pageCount)) targets.add(n)
    }

    const ordered = [...targets].sort((a, b) => a - b)
    const firstFull = ordered.find((n) => fullTablePages.has(n)) ?? Math.min(...ordered)
    const tablePasses: Array<{
      page: number
      tableCanvas: HTMLCanvasElement
      words: OcrWordBox[]
    }> = []
    let usedTesseractFallback = false
    for (const n of ordered) {
      if (legendPages.has(n)) continue
      const kind: 'main' | 'overflow' = n === firstFull ? 'main' : 'overflow'
      onProgress?.(
        `Reading membership table in ${file.name} — PDF page ${n} of ${pageCount}`,
      )
      const page = await pdf.getPage(n)
      let text = await pageText(page)
      const needsOcr = (text.match(/[A-Za-z]/g) ?? []).length < TEXT_LETTER_THRESHOLD
      if (needsOcr) {
        try {
          const canvas = await renderPage(page, TABLE_SCALE, ocrRenderRotation(page))
          if (canvasInkRatio(canvas) < BLANK_INK_RATIO) {
            result.warnings.push(`Page ${n} rendered blank during table read.`)
          } else {
            const ocr = await ocrMembershipTable(
              canvas,
              (step) =>
                onProgress?.(
                  `Reading membership table — page ${n} of ${pageCount} (${step})`,
                ),
              kind,
            )
            tablePasses.push({ page: n, tableCanvas: ocr.tableCanvas, words: ocr.words })
            if (ocr.engine === 'tesseract') usedTesseractFallback = true
            if (ocr.text.trim()) {
              text = ocr.text
              result.usedOcr = true
            }
          }
        } catch (err) {
          result.warnings.push(
            `Table OCR failed on page ${n}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }

      const rows = parseMembershipRows(text, n)
      if (rows.length > 0) {
        result.membershipPages.push(n)
        result.members.push(...rows)
      } else if (kind === 'main') {
        result.warnings.push(
          `Page ${n} looks like Membership Detail but no subscriber rows were read.`,
        )
      }
    }

    if (usedTesseractFallback) {
      result.warnings.push(
        'PaddleOCR did not read this table, so Tesseract was used. Charges may need more typing.',
      )
    }

    const ocrMembers = mergeMemberLists([result.members]).map((row, i) =>
      hydrateMemberRow({ ...row, rowIndex: i + 1 }),
    )
    result.members = ocrMembers

    const roster = (options?.roster ?? []).map((n) => n.trim()).filter(Boolean)
    if (roster.length > 0) {
      result.members = applyMemberRoster(roster, ocrMembers)
      result.members = fillMissingFromLeftover(result.members, unusedOcrRows(roster, ocrMembers))

      const stillMissing = () => result.members.filter(isMissingOnInvoice)
      if (stillMissing().length > 0 && tablePasses.length > 0) {
        const occupied: NameHint[] = []
        for (let i = 0; i < result.members.length; i++) {
          const member = result.members[i]
          if (!isMissingOnInvoice(member)) continue
          onProgress?.(`Looking again for ${member.name}`)
          let best: { hint: NameHint; pass: (typeof tablePasses)[number] } | null = null
          for (const pass of tablePasses) {
            const hint = findNameHint(pass.words, member.name, pass.tableCanvas.width, occupied)
            if (hint && (!best || hint.score > best.hint.score)) best = { hint, pass }
          }
          if (!best) continue
          occupied.push(best.hint)
          try {
            const strip = rowStripRect(
              best.hint,
              best.pass.tableCanvas.width,
              best.pass.tableCanvas.height,
            )
            const crops = retryCrops(strip)
            const nameText = (
              await recognizeField(cropRect(best.pass.tableCanvas, crops.name), 'name')
            ).text
            const codesText = (
              await recognizeField(cropRect(best.pass.tableCanvas, crops.codes), 'line')
            ).text
            const amountText = (
              await recognizeField(cropRect(best.pass.tableCanvas, crops.amount), 'amount')
            ).text
            const recovered = memberFromRetryText(
              member.name,
              best.pass.page,
              member.rowIndex,
              nameText,
              `${codesText} ${amountText}`,
            )
            if (recovered) result.members[i] = recovered
          } catch (err) {
            result.warnings.push(
              `Second look for ${member.name} failed: ${err instanceof Error ? err.message : String(err)}`,
            )
          }
        }
      }

      if (ocrMembers.length === 0) {
        result.warnings.push(
          'Could not read subscriber lines from this PDF. Showing the employee list with no charges filled in.',
        )
      } else {
        const leftover = unusedOcrRows(roster, ocrMembers)
        result.unmatchedOcr = leftoverOcrAfterFill(result.members, leftover)
        const missing = stillMissing()
        if (missing.length > 0) {
          result.warnings.push(
            `${missing.length} member${missing.length === 1 ? '' : 's'} on the list were not found on this invoice: ${missing.map((m) => m.name).join('; ')}`,
          )
        }
        const ignored = ignoredOcrWarning(result.unmatchedOcr)
        if (ignored) result.warnings.push(ignored)
      }
    } else {
      result.warnings.push('Add at least one member to the list before reading an invoice.')
    }

    if (result.members.length === 0) {
      const blankHint = result.warnings.find((w) => /rendered blank/i.test(w))
      const ocrHint = result.warnings.find((w) => /OCR failed/i.test(w))
      result.errors.push(
        blankHint
          ? 'Could not decode the scanned pages. Reload the app and drop the PDF again — the image decoder loads on first start.'
          : ocrHint
            ? `Could not read this scan (${ocrHint}). Reload and try again.`
            : 'No membership rows found. Kaiser member charges are on the Membership Detail pages (often printed page 3, with overflow onto page 4).',
      )
    }
  } catch (err) {
    result.errors.push(`Failed to parse: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await pdf.cleanup()
    await loadingTask.destroy()
  }

  return result
}

export async function finishOcr(): Promise<void> {
  const { terminatePaddleOcr } = await import('./paddleOcr')
  await Promise.all([terminateOcrWorker(), terminatePaddleOcr()])
}

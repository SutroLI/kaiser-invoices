import type { MemberRow, Rect } from '../types'
import { KAISER_COLUMNS, columnRect } from './detectTableRows'
import {
  lastNameHintScore,
  rosterMatchScore,
  rowFromOcrHit,
} from './matchRoster'
import type { OcrWordBox } from './ocrPage'
import {
  extractMoneyFromLine,
  hydrateMemberRow,
  parseMembershipRows,
} from './parseMembershipText'

export type NameHint = {
  score: number
  hint: string
  y0: number
  y1: number
}

const HINT_THRESHOLD = 0.56
const ACCEPT_THRESHOLD = 0.58

function overlaps(a: { y0: number; y1: number }, b: { y0: number; y1: number }, pad = 8): boolean {
  return a.y0 < b.y1 + pad && b.y0 < a.y1 + pad
}

export function groupWordRows(words: OcrWordBox[]): OcrWordBox[][] {
  const usable = [...words].filter((w) => w.text.trim())
  usable.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
  const rows: OcrWordBox[][] = []
  for (const word of usable) {
    const last = rows[rows.length - 1]
    if (!last) {
      rows.push([word])
      continue
    }
    const avgY = last.reduce((s, w) => s + (w.y0 + w.y1) / 2, 0) / last.length
    const avgH = last.reduce((s, w) => s + Math.max(1, w.y1 - w.y0), 0) / last.length
    const y = (word.y0 + word.y1) / 2
    if (Math.abs(y - avgY) <= Math.max(avgH, 10) * 0.7) last.push(word)
    else rows.push([word])
  }
  return rows
}

/** Locate a skipped member in first-pass OCR word boxes so we can re-read that row. */
export function findNameHint(
  words: OcrWordBox[],
  rosterName: string,
  tableWidth: number,
  occupied: Array<{ y0: number; y1: number }> = [],
): NameHint | null {
  let best: NameHint | null = null
  for (const row of groupWordRows(words)) {
    const left = row.filter((w) => w.x0 < tableWidth * 0.42)
    const tokens = left.length > 0 ? left : row
    if (tokens.length === 0) continue
    const hint = tokens.map((w) => w.text).join(' ')
    let score = Math.max(rosterMatchScore(rosterName, hint), lastNameHintScore(rosterName, hint))
    for (const w of tokens) {
      score = Math.max(score, lastNameHintScore(rosterName, w.text))
    }
    if (score < HINT_THRESHOLD) continue
    const y0 = Math.min(...row.map((w) => w.y0))
    const y1 = Math.max(...row.map((w) => w.y1))
    if (occupied.some((used) => overlaps(used, { y0, y1 }))) continue
    if (!best || score > best.score) best = { score, hint, y0, y1 }
  }
  return best
}

export function rowStripRect(hint: NameHint, tableWidth: number, tableHeight: number): Rect {
  const h = Math.max(hint.y1 - hint.y0, 12)
  const pad = h * 0.45
  const y = Math.max(0, hint.y0 - pad)
  const bottom = Math.min(tableHeight, hint.y1 + pad)
  return { x: 0, y, w: tableWidth, h: Math.max(1, bottom - y) }
}

export function retryCrops(strip: Rect): { name: Rect; codes: Rect; amount: Rect } {
  return {
    name: columnRect(strip, KAISER_COLUMNS.name),
    codes: columnRect(strip, KAISER_COLUMNS.codes),
    amount: columnRect(strip, KAISER_COLUMNS.amount),
  }
}

export function memberFromRetryText(
  rosterName: string,
  page: number,
  rowIndex: number,
  nameText: string,
  restText: string,
): MemberRow | null {
  const line = `${nameText} ${restText}`.trim()
  const parsed = parseMembershipRows(line, page)
  const hit =
    parsed.find((row) => rosterMatchScore(rosterName, row.name) >= ACCEPT_THRESHOLD) ?? null
  if (hit) {
    return rowFromOcrHit(rosterName, hit, rowIndex)
  }
  const nameOk =
    rosterMatchScore(rosterName, nameText) >= ACCEPT_THRESHOLD ||
    lastNameHintScore(rosterName, nameText) >= 0.85
  if (!nameOk) return null
  const amounts = extractMoneyFromLine(restText)
  return hydrateMemberRow({
    rowIndex,
    name: rosterName,
    ocrName: nameText.replace(/\s+/g, ' ').trim(),
    familyCount: null,
    coverage: '',
    status: '',
    medicalPlan: '',
    medicalCurrentCharge: amounts[0] ?? null,
    page,
    flags: amounts[0] == null ? ['Missing medical current charge'] : [],
  })
}

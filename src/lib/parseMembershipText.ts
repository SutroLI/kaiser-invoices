import { MEDICAL_PLANS, STATUS_CODES } from './codes'
import type { ExtractedAmountField, ExtractedTextField, InvoiceMeta, MemberRow } from '../types'

const NAME_RE = /^[A-Z][A-Z'./ -]+,\s+[A-Z][A-Z'./ -]*$/

const PERIOD_RE = /^\d{2}\/\d{4}$/

const SKIP_LINE_RE =
  /^(name|family count|medicare|subscriber|coverage|status|medical plan|medical current|retro activity|period|code|amount|total due|subtotal|membership detail|current coverage month|any activity processed|page \d+ of|kaiser|consolidated billing|statement id|invoice date|bill period|n\/a)$/i

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim()
}

/** OCR often splits `$1,800.00` into `$1 , 800.00` or `$783 .00`. */
export function glueSpacedMoney(text: string): string {
  return text
    .replace(/\$\s+/g, '$')
    .replace(/(\d)\s*,\s*(\d)/g, '$1,$2')
    .replace(/(\d)\s+\.\s*(\d{2})\b/g, '$1.$2')
}

export function cleanOcrLine(line: string): string {
  return line
    .replace(/[[\]{}()]/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/[._](?=[A-Za-z]{2,})/g, ', ')
    .replace(/,(?=[A-Za-z])/g, ', ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .toUpperCase()
}

export function parseMoney(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '').replace(/^\((.+)\)$/, '-$1')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Pull a money amount out of noisy OCR tokens like `$1,196.00}` or `$221600`. */
export function extractMoney(token: string): number | null {
  const hasDollar = /\$/.test(token)
  const stripped = token.replace(/[^\d.$,-]/g, '')
  const thousandsDots = stripped.match(/-?\$?(\d{1,3})\.(\d{3})\.(\d{2})/)
  if (thousandsDots) {
    return parseMoney(`${thousandsDots[1]},${thousandsDots[2]}.${thousandsDots[3]}`)
  }
  // `$1.24600` / `$1,80000` — thousands separator + cents with no second dot.
  const gluedThousands = stripped.match(/-?\$?(\d{1,3})[.,](\d{3})(\d{2})\b/)
  if (gluedThousands) {
    return parseMoney(`${gluedThousands[1]},${gluedThousands[2]}.${gluedThousands[3]}`)
  }
  // `$1.357` / `$1.196` (comma read as a period, cents dropped)
  const thousandsNoCents = stripped.match(/-?\$?(\d{1,3})\.(\d{3})$/)
  if (thousandsNoCents) {
    return Number(`${thousandsNoCents[1]}${thousandsNoCents[2]}`)
  }
  const dotted = stripped.match(/-?\$?[\d,]+\.\d{2}/)
  if (dotted) {
    const n = parseMoney(dotted[0])
    // `$1.35` is almost always a chopped `$1,357.00`, not a $1.35 premium.
    if (n != null && n !== 0 && Math.abs(n) < 20) return null
    if (n != null) return n
  }

  const digits = stripped.replace(/[^\d-]/g, '')
  if (/^-?\d{3,7}00$/.test(digits) && Math.abs(Number(digits)) >= 10000) {
    const neg = digits.startsWith('-')
    const body = neg ? digits.slice(1) : digits
    const dollars = body.slice(0, -2)
    const cents = body.slice(-2)
    const n = Number(`${neg ? '-' : ''}${dollars}.${cents}`)
    return Number.isFinite(n) ? n : null
  }
  // `$2160` (cents dropped) — only trust this when OCR kept the $ so IDs stay IDs.
  if (hasDollar && /^-?\d{3,5}$/.test(digits)) {
    const n = Number(digits)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Find every money-like value on a noisy OCR line, left to right. */
export function extractMoneyFromLine(line: string): number[] {
  const found: number[] = []
  const push = (n: number | null) => {
    if (n == null || Number.isNaN(n)) return
    if (found[found.length - 1] === n) return
    found.push(n)
  }

  const t = glueSpacedMoney(line.replace(/[–—]/g, '-').replace(/~~+/g, ' '))

  for (const m of t.matchAll(/-?\$\s*\d[\d,.]*/g)) {
    push(extractMoney(m[0]))
  }
  // Same patterns without a surviving dollar sign, only at the end of the line.
  const tail = t.slice(Math.max(0, t.length - 48))
  for (const m of tail.matchAll(/(\d{1,3}[.,]\d{3}[.,]\d{2}|\d{1,3}[.,]\d{3}\d{2}|\d+\.\d{2})/g)) {
    push(extractMoney(m[0]))
  }
  return found
}

function pickCurrentCharge(
  amounts: number[],
  status: string,
  hadRetro = false,
): number | null {
  if (status === 'T') return 0
  const plausible = amounts.filter((n) => n === 0 || (Math.abs(n) >= 50 && Math.abs(n) <= 8000))
  if (plausible.length === 0) return null
  // Terminated rows print $0.00 current, then retro MEDICAL amounts. Don't
  // promote those retro figures into current charge.
  if (hadRetro) return plausible[0]
  if (plausible[0] === 0) {
    const positive = plausible.find((n) => n > 0)
    if (positive != null) return positive
    return 0
  }
  return plausible[0]
}

function isName(value: string): boolean {
  const v = value.trim().replace(/\s+/g, ' ')
  if (v.length < 7 || v.length > 70) return false
  if (!NAME_RE.test(v)) return false
  if (/DETAIL|GROUP|KAISER|PAGE|SUBTOTAL|MEMBERSHIP|BILLING|PERMANENTE|SACRAMENTO|EMPLOYEE|COVERAGE|STATUS|MEDICAL|LEGEND|ACTIVITY|PLEASE|BALANCE|PAYMENT|AMOUNT|PREVIOUS|ACCOUNTS|INCLUDED|SUMMARY|CONSOLIDATED/i.test(v)) {
    return false
  }
  const [lastRaw, firstRaw] = v.split(',')
  const last = (lastRaw ?? '').trim()
  const first = (firstRaw ?? '').trim()
  const lastLetters = last.replace(/[^A-Za-z]/g, '')
  const firstWords = first.split(/\s+/).filter(Boolean)
  if (lastLetters.length < 3) return false
  if (!/[AEIOUY]/i.test(lastLetters)) return false
  if (firstWords.length === 0) return false
  const firstMain = firstWords[0].replace(/[^A-Za-z]/g, '')
  if (firstMain.length < 2) return false
  if (['E', 'ES', 'ED', 'ESD', 'EA', 'EE', 'NA'].includes(lastLetters.toUpperCase())) return false
  const shortTokens = v.split(/[\s,]+/).filter((t) => t.replace(/[^A-Za-z]/g, '').length <= 2)
  const allTokens = v.split(/[\s,]+/).filter(Boolean)
  if (allTokens.length >= 3 && shortTokens.length / allTokens.length >= 0.6) return false
  return last.split(' ').length <= 4
}

function matchCoverage(token: string): string | null {
  const t = token.toUpperCase().replace(/[^A-Z]/g, '')
  if (!t) return null
  if (['ESD', 'ESB', 'ESP', 'ESO', 'ESD'].includes(t)) return 'ESD'
  if (t === 'ED' || t === 'EP') return 'ED'
  if (t === 'ES') return 'ES'
  if (t === 'EA') return 'EA'
  if (t === 'E' || t === 'EE') return 'E'
  return null
}

function matchStatus(token: string): string | null {
  const t = token.toUpperCase().replace(/[^A-Z]/g, '')
  if ((STATUS_CODES as readonly string[]).includes(t)) return t
  if (t === 'TV' || t === 'TT') return 'T'
  if (t === 'AA') return 'A'
  return null
}

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[m][n]
}

function matchPlan(token: string): string | null {
  if (/[$\d]/.test(token)) return null
  const t = token.toUpperCase().replace(/[^A-Z]/g, '')
  if (t.length < 3 || t.length > 10) return null
  // Retro-activity "Code" column, not the subscriber's medical plan.
  if (t === 'MEDICAL') return null
  const exact = (MEDICAL_PLANS as readonly string[]).find((p) => p.replace(/\s+/g, '') === t)
  if (exact) return exact
  const hits = ['D', 'H', 'M', 'O'].filter((c) => t.includes(c)).length
  // MINDY/ADAM have D+M but are names, not DHMO OCR. Need H, leading D, or an O.
  if (
    t !== 'MEDICAL' &&
    t.length >= 3 &&
    t.length <= 5 &&
    t.includes('M') &&
    (t.includes('DH') || t.includes('HM') || t.startsWith('D') || (t.includes('O') && hits >= 2))
  ) {
    return 'DHMO'
  }
  if (t.length >= 4) {
    for (const plan of MEDICAL_PLANS) {
      const p = plan.replace(/\s+/g, '')
      if (p.length >= 4 && Math.abs(p.length - t.length) <= 1 && levenshtein(t, p) <= 1) {
        return plan
      }
    }
  }
  return null
}

function looksLikeSubscriberId(token: string): boolean {
  const t = token.toUpperCase()
  if (/X{2,}/.test(t) && /\d/.test(t)) return true
  if (/X{2,3}[-.\s]?X{2}/.test(t)) return true
  if (/^\d{0,3}X{2,}/.test(t)) return true
  return false
}

const INVOICE_NAME_PART =
  /^(PLEASE|PAY|AMOUNT|BALANCE|BALA|NCE|EMPLO|YEE|EMPLOYEE|PREVIOUS|PAYMENT|TOTAL|DUE|ACCOUNTS|INCLUDED|SUMMARY|CURRENT|ACTIVITY|RETRO|STD)$/i

function isJunkRowName(name: string): boolean {
  const n = name.trim().toUpperCase()
  if (n === 'N/A' || n === 'NA' || n === 'N / A' || n.startsWith('SUBTOTAL') || n.startsWith('STD')) {
    return true
  }
  if (/\b(DHMO|MEDICAL|SUBTOTAL|PAGE|ESD|ESP)\b/.test(n)) return true
  const [last = '', first = ''] = n.split(',')
  const lastWord = last.trim().split(/\s+/)[0] ?? ''
  const firstWord = first.trim().split(/\s+/)[0] ?? ''
  if (INVOICE_NAME_PART.test(lastWord) || INVOICE_NAME_PART.test(firstWord)) return true
  return false
}

function looksLikeNameWord(token: string, minLetters: number): boolean {
  const letters = token.replace(/[^A-Za-z]/g, '')
  return letters.length >= minLetters && /[AEIOUY]/i.test(letters)
}

/** LASTFIRST with the comma/space dropped, e.g. DIBBLESEAN → DIBBLE, SEAN. */
function splitFusedNameToken(token: string): string | null {
  if (/[$,\d]/.test(token) || looksLikeSubscriberId(token)) return null
  const t = token.toUpperCase().replace(/[^A-Z'-]/g, '')
  if (t.length < 7 || t.length > 22) return null

  let best: { name: string; score: number } | null = null
  for (let i = 4; i <= Math.min(12, t.length - 3); i++) {
    const last = t.slice(0, i)
    const first = t.slice(i)
    if (first.length > 12) continue
    const name = `${last}, ${first}`
    if (!isName(name)) continue
    const score =
      -Math.abs(last.length - 6) -
      Math.abs(Math.min(first.length, 8) - 5) +
      (last.length >= 5 && last.length <= 8 ? 2 : 0) +
      (/^[BCDFGHJKLMNPQRSTVWXYZ]/.test(first) ? 1 : 0)
    if (!best || score > best.score) best = { name, score }
  }
  return best?.name ?? null
}

function insertCommaIfMissing(line: string): string {
  const tokens = line.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return line
  const head = tokens.slice(0, 3).join(' ')
  if (head.includes(',')) return line

  if (
    tokens.length >= 2 &&
    looksLikeNameWord(tokens[0], 4) &&
    looksLikeNameWord(tokens[1], 3)
  ) {
    return `${tokens[0]}, ${tokens.slice(1).join(' ')}`
  }

  const fused = splitFusedNameToken(tokens[0])
  if (fused) return `${fused} ${tokens.slice(1).join(' ')}`.trim()
  return line
}

/** Pull invoice header fields from any page of OCR / PDF text. */
export function parseInvoiceMeta(text: string): Partial<InvoiceMeta> {
  const t = normalizeWhitespace(text)
  const grab = (re: RegExp): string => t.match(re)?.[1]?.trim() ?? ''

  const totalRaw =
    grab(/Please pay this Amount[:\s]*\$?([\d,]+\.\d{2})/i) ||
    grab(/Total Amount Due[:\s]*\$?([\d,]+\.\d{2})/i) ||
    grab(/Total Charges[:\s]*\$?([\d,]+\.\d{2})/i)

  return {
    customerName: grab(
      /(?:^|\n)([A-Z][A-Z0-9 .,'&/-]{5,60})\s*(?:\n|.){0,80}Consolidated Billing ID/i,
    ),
    billingId: grab(/Consolidated Billing ID[:\s]*(\d{6,})/i),
    statementId: grab(/Statement ID[:.\s]*(\d{6,})/i),
    invoiceDate: grab(/Invoice Date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i),
    billPeriod: grab(/Bill Period[:\s]*([A-Za-z]+ \d{4})/i),
    dueDate: grab(/Due (?:Date|Before)[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i),
    totalAmountDue: totalRaw ? parseMoney(totalRaw) : null,
  }
}

export function mergeMeta(base: InvoiceMeta, next: Partial<InvoiceMeta>): InvoiceMeta {
  return {
    customerName: base.customerName || next.customerName || '',
    billingId: base.billingId || next.billingId || '',
    statementId: base.statementId || next.statementId || '',
    invoiceDate: base.invoiceDate || next.invoiceDate || '',
    billPeriod: base.billPeriod || next.billPeriod || '',
    dueDate: base.dueDate || next.dueDate || '',
    totalAmountDue: base.totalAmountDue ?? next.totalAmountDue ?? null,
  }
}

export function emptyMeta(): InvoiceMeta {
  return {
    customerName: '',
    billingId: '',
    statementId: '',
    invoiceDate: '',
    billPeriod: '',
    dueDate: '',
    totalAmountDue: null,
  }
}

export function isLegendText(text: string): boolean {
  const t = text.replace(/\s+/g, ' ')
  if (/Membership Detail/i.test(t)) return false
  return /Medical Plan Legend|Coverage Type|Employee Only/i.test(t)
}

export function isMembershipDetailText(text: string): boolean {
  const t = text.replace(/\s+/g, ' ')
  if (isLegendText(t)) return false
  if (/Membership Detail/i.test(t)) return true
  const hasName = /\bName\b/i.test(t)
  const hasFamily = /Family Count/i.test(t)
  const hasCharge = /Medical current charge/i.test(t)
  return hasName && hasFamily && hasCharge
}

function subscriberNameHits(text: string): number {
  return (text.match(/[A-Z]{4,}\s*,\s*[A-Z]{3,}/g) ?? []).length
}

/** Printed page 3 — the long grid. */
export function looksLikeFullMembershipTable(text: string): boolean {
  if (isLegendText(text)) return false
  const names = subscriberNameHits(text)
  if (names >= 8) return true
  return isMembershipDetailText(text) && names >= 5 && !looksLikeOverflowMembershipPage(text)
}

/** Printed page 4 — leftover subscriber + subtotals / empty COBRA group. */
export function looksLikeOverflowMembershipPage(text: string): boolean {
  const names = subscriberNameHits(text)
  if (names >= 5) return false
  if (/Bill Group ID\s*7001/i.test(text) && names <= 6) return true
  if (/Subtotal for Bill Group/i.test(text) && names <= 6) return true
  if (/Page\s*4\s*of/i.test(text) && names <= 6) return true
  return isMembershipDetailText(text) && names > 0 && names <= 4
}

function isUsableRow(row: MemberRow): boolean {
  if (isJunkRowName(row.name)) return false
  const hasCode = Boolean(row.coverage || row.status || row.medicalPlan)
  const hasNumber = row.familyCount != null || row.medicalCurrentCharge != null
  if (!hasNumber) return false
  return hasCode || row.medicalCurrentCharge != null
}

function tokenizeLine(line: string): string[] {
  return insertCommaIfMissing(cleanOcrLine(line))
    .replace(/(\$?-?[\d,]+\.\d{2})/g, ' $1 ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function familyCountFromToken(token: string): number | null {
  if (/^\d{1,2}$/.test(token) && Number(token) <= 20) return Number(token)
  if (/^[A-Z]\d{1,2}$/.test(token)) {
    const n = Number(token.slice(1))
    if (n <= 20) return n
  }
  return null
}

function isNameStopToken(token: string): boolean {
  if (familyCountFromToken(token) != null) return true
  if (/^[NY]$/i.test(token.replace(/[^A-Za-z]/g, ''))) return true
  if (looksLikeSubscriberId(token)) return true
  if (extractMoney(token) != null) return true
  if (PERIOD_RE.test(token)) return true
  const letters = token.replace(/[^A-Za-z]/g, '')
  if (letters.length >= 2 && (matchCoverage(token) || matchPlan(token))) return true
  return false
}

function nameShapeScore(name: string): number {
  const first = name.split(',')[1]?.trim() ?? ''
  const words = first.split(/\s+/).filter(Boolean)
  if (words.length === 2 && words[1].replace(/[^A-Za-z]/g, '').length <= 2) return 20
  if (
    words.length === 2 &&
    /[AEIOUY]/i.test(words[1]) &&
    words[1].replace(/[^A-Za-z]/g, '').length <= 8
  ) {
    return 18
  }
  if (words.length === 1) return 16
  if (words.length === 3 && words[2].replace(/[^A-Za-z]/g, '').length <= 2) return 15
  return Math.max(0, 5 - words.length)
}

function consumeName(tokens: string[], start: number): { name: string; next: number } | null {
  const buf: string[] = []
  for (let i = start; i < tokens.length && buf.length < 6; i++) {
    if (buf.length > 0 && isNameStopToken(tokens[i])) break
    buf.push(tokens[i])
  }
  while (buf.length >= 3 && buf[buf.length - 1].replace(/[^A-Za-z]/g, '').length >= 3) {
    const shorter = buf.slice(0, -1).join(' ')
    if (isName(shorter)) buf.pop()
    else break
  }
  let best: { name: string; next: number; score: number } | null = null
  for (let take = buf.length; take >= 2; take--) {
    const candidate = buf.slice(0, take).join(' ').replace(/\s+/g, ' ').trim()
    if (!isName(candidate)) continue
    const score = nameShapeScore(candidate)
    if (!best || score > best.score || (score === best.score && take < best.next - start)) {
      best = { name: candidate, next: start + take, score }
    }
  }
  if (best) return { name: best.name, next: best.next }
  if (start < tokens.length && /,[A-Z]/.test(tokens[start])) {
    const fixed = tokens[start].replace(',', ', ')
    const rest = [fixed, ...tokens.slice(start + 1)]
    const inner = consumeName(rest, 0)
    if (!inner) return null
    return { name: inner.name, next: start + inner.next }
  }
  return null
}

function parseRowFromTokens(tokens: string[], page: number, rawLine = ''): MemberRow | null {
  const named = consumeName(tokens, 0)
  if (!named) return null
  if (isJunkRowName(named.name)) return null

  const rest = tokens.slice(named.next)
  const flags: string[] = []

  let i = 0
  const peek = () => rest[i] ?? ''
  const take = () => rest[i++] ?? ''

  let familyCount: number | null = null
  while (i < rest.length && familyCount == null) {
    const t = peek()
    const family = familyCountFromToken(t)
    if (family != null) {
      familyCount = family
      take()
      break
    }
    if (
      looksLikeSubscriberId(t) ||
      matchCoverage(t) ||
      matchStatus(t) ||
      matchPlan(t) ||
      extractMoney(t) != null
    ) {
      break
    }
    i += 1
  }

  if (/^[NY]$/i.test(peek().replace(/[^A-Za-z]/g, ''))) i += 1
  if (looksLikeSubscriberId(peek())) i += 1

  while (
    i < rest.length &&
    !matchCoverage(peek()) &&
    !matchStatus(peek()) &&
    !matchPlan(peek()) &&
    extractMoney(peek()) == null
  ) {
    i += 1
  }

  const coverage = matchCoverage(peek()) ?? ''
  if (coverage) i += 1

  let status = matchStatus(peek()) ?? ''
  if (status) i += 1
  if (!status) {
    const later = rest.slice(i, i + 6).map(matchStatus).find(Boolean)
    if (later) status = later
  }

  let medicalPlan = ''
  const two = `${peek()} ${rest[i + 1] ?? ''}`.trim()
  const twoMatch = matchPlan(two.replace(/\s+/g, ''))
  if (twoMatch) {
    medicalPlan = twoMatch
    i += 2
  } else {
    const one = matchPlan(peek())
    if (one) {
      medicalPlan = one
      i += 1
    }
  }
  if (!medicalPlan) {
    const later = rest.slice(i, i + 8).map(matchPlan).find(Boolean)
    if (later) medicalPlan = later
  }

  const periodIdx = rest.findIndex((t, idx) => idx >= i && (PERIOD_RE.test(t) || /^MEDICAL$/i.test(t)))
  const hadRetro = periodIdx !== -1 || /MEDICAL|\d{2}\/\d{4}/i.test(rawLine)
  const currentTokens = periodIdx === -1 ? rest.slice(i) : rest.slice(i, periodIdx)

  const currentMonies: number[] = []
  for (const t of currentTokens) {
    const money = extractMoney(t)
    if (money != null) currentMonies.push(money)
  }
  if (currentMonies.length === 0 && rawLine) {
    const cut = rawLine.search(/MEDICAL|\d{2}\/\d{4}/i)
    const head = cut === -1 ? rawLine : rawLine.slice(0, cut)
    currentMonies.push(...extractMoneyFromLine(head))
  }
  let medicalCurrentCharge = pickCurrentCharge(currentMonies, status, hadRetro)
  if (medicalCurrentCharge == null && status === 'T') {
    medicalCurrentCharge = 0
  }

  if (!coverage) flags.push('Missing coverage')
  if (!status) flags.push('Missing status')
  if (!medicalPlan) flags.push('Missing medical plan')
  if (medicalCurrentCharge == null) flags.push('Missing medical current charge')
  if (familyCount == null) flags.push('Missing family count')

  return hydrateMemberRow({
    name: named.name,
    familyCount,
    coverage,
    status,
    medicalPlan,
    medicalCurrentCharge,
    page,
    flags,
  })
}

export function hydrateMemberRow(
  row: Omit<MemberRow, 'rowIndex' | 'excluded' | 'nameField' | 'amountField'> &
    Partial<Pick<MemberRow, 'rowIndex' | 'excluded' | 'nameField' | 'amountField' | 'debugCrops' | 'ocrName'>>,
): MemberRow {
  const nameField: ExtractedTextField = row.nameField ?? {
    raw: row.name,
    value: row.name,
    confidence: null,
    status: row.name ? 'ok' : 'missing',
  }
  const amountField: ExtractedAmountField = row.amountField ?? {
    raw: row.medicalCurrentCharge == null ? '' : String(row.medicalCurrentCharge),
    value: row.medicalCurrentCharge,
    confidence: null,
    status: row.medicalCurrentCharge == null ? 'missing' : 'ok',
  }
  return {
    ...row,
    rowIndex: row.rowIndex ?? 0,
    excluded: row.excluded ?? false,
    nameField,
    amountField,
    name: nameField.value || row.name,
    medicalCurrentCharge: amountField.value ?? row.medicalCurrentCharge,
  }
}

/**
 * Parse Kaiser Membership Detail rows from page text (PDF extract or OCR).
 * One row per subscriber; retro-activity continuation lines are ignored.
 * Subtotals and empty COBRA / N/A groups are skipped.
 */
export function parseMembershipRows(text: string, page: number): MemberRow[] {
  const lines = glueSpacedMoney(normalizeWhitespace(text))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !SKIP_LINE_RE.test(l))

  const rows: MemberRow[] = []

  for (const line of lines) {
    if (SKIP_LINE_RE.test(line)) continue
    if (/^subtotal/i.test(line) || /^total (current|retro|charges|due)/i.test(line)) continue
    const tokens = tokenizeLine(line)
    const row = parseRowFromTokens(tokens, page, line)
    if (row && isUsableRow(row)) rows.push(row)
  }

  const streamTokens = tokenizeLine(lines.join(' '))
  let i = 0
  while (i < streamTokens.length) {
    const named = consumeName(streamTokens, i)
    if (!named) {
      i += 1
      continue
    }
    const window = streamTokens.slice(i, Math.min(streamTokens.length, named.next + 16))
    const row = parseRowFromTokens(window, page)
    if (row && isUsableRow(row)) {
      rows.push(row)
      i = named.next + 4
    } else {
      i += 1
    }
  }

  return dedupeRows(rows).map((row, i) => ({ ...row, rowIndex: i + 1 }))
}

function completeness(row: MemberRow): number {
  return (
    (row.medicalCurrentCharge != null ? 8 : 0) +
    (row.coverage ? 2 : 0) +
    (row.status ? 2 : 0) +
    (row.medicalPlan ? 2 : 0) +
    (row.familyCount != null ? 1 : 0)
  )
}

function nameKey(name: string): string {
  return name.replace(/[^A-Z]/gi, '').toUpperCase()
}

/** Prefer the real premium when OCR dropped a thousands digit ($119.00 vs $1,196.00). */
function pickMergedCharge(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null) return b ?? null
  if (b == null) return a
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  if (lo >= 50 && hi >= 500 && Math.abs(hi / lo - 10) < 0.2) return hi
  return a
}

function mergeRows(a: MemberRow, b: MemberRow): MemberRow {
  const winner = completeness(a) >= completeness(b) ? a : b
  const loser = winner === a ? b : a
  const charge = pickMergedCharge(winner.medicalCurrentCharge, loser.medicalCurrentCharge)
  const flags = winner.flags.filter((f) => {
    if (f === 'Missing medical current charge' && charge != null) return false
    if (f === 'Missing coverage' && (winner.coverage || loser.coverage)) return false
    if (f === 'Missing status' && (winner.status || loser.status)) return false
    if (f === 'Missing medical plan' && (winner.medicalPlan || loser.medicalPlan)) return false
    if (f === 'Missing family count' && (winner.familyCount != null || loser.familyCount != null)) {
      return false
    }
    return true
  })
  return {
    ...winner,
    familyCount: winner.familyCount ?? loser.familyCount,
    coverage: winner.coverage || loser.coverage,
    status: winner.status || loser.status,
    medicalPlan: winner.medicalPlan || loser.medicalPlan,
    medicalCurrentCharge: charge,
    flags,
    nameField: winner.nameField,
    amountField: {
      ...winner.amountField,
      value: charge,
      status: charge == null ? 'missing' : winner.amountField.status,
    },
  }
}

function namesLikelySame(a: string, b: string): boolean {
  const ka = nameKey(a)
  const kb = nameKey(b)
  if (ka === kb) return true
  if (ka.length < 8 || kb.length < 8) return false
  if (Math.abs(ka.length - kb.length) > 6) return false
  const dist = levenshtein(ka, kb)
  if (dist <= 1) return true
  if (dist <= 3 && ka.slice(0, 8) === kb.slice(0, 8)) return true
  return false
}

function dedupeRows(rows: MemberRow[]): MemberRow[] {
  const out: MemberRow[] = []
  for (const row of rows) {
    const idx = out.findIndex((prev) => namesLikelySame(prev.name, row.name))
    if (idx === -1) out.push(row)
    else out[idx] = mergeRows(out[idx], row)
  }
  return out
}

export function mergeMemberLists(groups: MemberRow[][]): MemberRow[] {
  return dedupeRows(groups.flat())
}

export function formatMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

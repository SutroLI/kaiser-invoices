import type { MemberRow } from '../types'
import { hydrateMemberRow } from './parseMembershipText'

function letters(value: string): string {
  return value.replace(/[^A-Z]/gi, '').toUpperCase()
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

function ratio(a: string, b: string): number {
  if (!a || !b) return 0
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length)
}

function nameWords(value: string): string[] {
  return value
    .toUpperCase()
    .replace(/[._]/g, ' ')
    .split(/[^A-Z]+/)
    .filter((w) => w.length >= 2)
}

function splitLastFirst(name: string): { last: string; first: string } {
  const cleaned = name.toUpperCase().replace(/[._]/g, ' ').trim()
  const comma = cleaned.indexOf(',')
  if (comma >= 0) {
    return { last: letters(cleaned.slice(0, comma)), first: letters(cleaned.slice(comma + 1)) }
  }
  return { last: letters(cleaned), first: '' }
}

/** Last-name guesses from noisy OCR: "EE DIBBLE, SEAN" → DIBBLE, EEDIBBLE. */
function ocrLastNameCandidates(ocrName: string): string[] {
  const cleaned = ocrName.toUpperCase().replace(/[._]/g, ' ').trim()
  const comma = cleaned.indexOf(',')
  const before = comma >= 0 ? cleaned.slice(0, comma) : cleaned
  const words = nameWords(before)
  const out: string[] = []
  if (words.length > 0) out.push(words[words.length - 1])
  if (words.length >= 2) out.push(words.slice(-2).join(''))
  out.push(letters(before))
  return [...new Set(out.filter((w) => w.length >= 2))]
}

function lastNameScore(rosterLast: string, ocrName: string): number {
  const oAll = letters(ocrName)
  if (rosterLast.length < 3 || oAll.length < 3) return 0
  let best = 0
  if (rosterLast.length >= 4 && oAll.includes(rosterLast)) best = Math.max(best, 0.92)
  for (const oLast of ocrLastNameCandidates(ocrName)) {
    best = Math.max(best, ratio(rosterLast, oLast))
    if (
      rosterLast.length >= 4 &&
      (oLast.includes(rosterLast) || (rosterLast.includes(oLast) && oLast.length >= 5))
    ) {
      best = Math.max(best, 0.9)
    }
    if (rosterLast.length >= 5 && oLast.length >= 4) {
      if (rosterLast.startsWith(oLast) || oLast.startsWith(rosterLast.slice(0, 5))) {
        best = Math.max(best, 0.82)
      }
    }
  }
  return best
}

/** How close an OCR token is to the roster last name. Used to find a skipped row. */
export function lastNameHintScore(rosterName: string, token: string): number {
  return lastNameScore(splitLastFirst(rosterName).last, token)
}

/** How well an OCR name matches a known roster name. 0–1. */
export function rosterMatchScore(rosterName: string, ocrName: string): number {
  const r = splitLastFirst(rosterName)
  const o = splitLastFirst(ocrName)
  const rAll = letters(rosterName)
  const oAll = letters(ocrName)
  if (rAll.length < 4 || oAll.length < 3) return 0

  let last = lastNameScore(r.last, ocrName)
  if (o.first.length === 0 && r.last.length >= 4) {
    if (oAll.startsWith(r.last) || oAll.includes(r.last)) last = Math.max(last, 0.94)
    last = Math.max(last, ratio(r.last, oAll.slice(0, r.last.length)))
  }
  const firstLen = Math.min(8, Math.max(r.first.length, o.first.length, 1))
  const first = ratio(r.first.slice(0, firstLen), o.first.slice(0, firstLen))
  const full = ratio(rAll, oAll)
  return last * 0.62 + first * 0.23 + full * 0.15
}

const MATCH_THRESHOLD = 0.58

function ocrRowQuality(row: MemberRow): number {
  return (
    (row.medicalCurrentCharge != null ? 8 : 0) +
    (row.coverage ? 2 : 0) +
    (row.status ? 2 : 0) +
    (row.medicalPlan ? 2 : 0) +
    (row.familyCount != null ? 1 : 0)
  )
}

export function assignRosterMatches(
  roster: string[],
  ocrRows: MemberRow[],
): { matched: Map<number, MemberRow>; unmatchedOcr: number } {
  const candidates: Array<{ ri: number; oi: number; score: number; quality: number }> = []
  for (let ri = 0; ri < roster.length; ri++) {
    for (let oi = 0; oi < ocrRows.length; oi++) {
      const score = rosterMatchScore(roster[ri], ocrRows[oi].name)
      if (score >= MATCH_THRESHOLD) {
        candidates.push({ ri, oi, score, quality: ocrRowQuality(ocrRows[oi]) })
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.quality - a.quality)

  const usedRoster = new Set<number>()
  const usedOcr = new Set<number>()
  const matched = new Map<number, MemberRow>()
  for (const c of candidates) {
    if (usedRoster.has(c.ri) || usedOcr.has(c.oi)) continue
    usedRoster.add(c.ri)
    usedOcr.add(c.oi)
    matched.set(c.ri, ocrRows[c.oi])
  }
  return { matched, unmatchedOcr: ocrRows.length - usedOcr.size }
}

export const NOT_FOUND_FLAG = 'Not found on this invoice'
export const ADDED_ROW_FLAG = 'Added row'

export function ignoredOcrWarning(rows: MemberRow[]): string | null {
  if (rows.length === 0) return null
  const names = rows.map((r) => r.name).join('; ')
  const n = rows.length
  return `${n} OCR row${n === 1 ? '' : 's'} did not match the member list and ${n === 1 ? 'was' : 'were'} ignored: ${names}`
}

export function leftoverOcrAfterFill(members: MemberRow[], leftover: MemberRow[]): MemberRow[] {
  const used = new Set(members.map((m) => m.ocrName).filter(Boolean))
  return leftover.filter((row) => {
    if (used.has(row.name)) return false
    return !members.some(
      (m) =>
        rosterMatchScore(m.name, row.name) >= MATCH_THRESHOLD ||
        lastNameHintScore(m.name, row.name) >= 0.88,
    )
  })
}

export function isMissingOnInvoice(row: MemberRow): boolean {
  return row.flags.includes(NOT_FOUND_FLAG)
}

export function rowFromOcrHit(name: string, hit: MemberRow, rowIndex: number, extraFlags: string[] = []): MemberRow {
  const flags = [
    ...hit.flags.filter((f) => !/name/i.test(f) && f !== NOT_FOUND_FLAG),
    ...extraFlags,
  ]
  if (hit.medicalCurrentCharge == null) flags.push('Missing medical current charge')
  return hydrateMemberRow({
    ...hit,
    rowIndex,
    name,
    ocrName: hit.name,
    flags,
    nameField: { raw: hit.name, value: name, confidence: null, status: 'ok' },
    amountField: hit.amountField,
  })
}

export function unusedOcrRows(roster: string[], ocrRows: MemberRow[]): MemberRow[] {
  const { matched } = assignRosterMatches(roster, ocrRows)
  const used = new Set(matched.values())
  return ocrRows.filter((row) => !used.has(row))
}

/** Second chance: leftover OCR rows, including last-name-only hits the first pass skipped. */
export function fillMissingFromLeftover(members: MemberRow[], leftover: MemberRow[]): MemberRow[] {
  const missingIdx = members.map((m, i) => (isMissingOnInvoice(m) ? i : -1)).filter((i) => i >= 0)
  if (missingIdx.length === 0 || leftover.length === 0) return members

  const candidates: Array<{ slot: number; oi: number; score: number }> = []
  for (let slot = 0; slot < missingIdx.length; slot++) {
    const name = members[missingIdx[slot]].name
    for (let oi = 0; oi < leftover.length; oi++) {
      const full = rosterMatchScore(name, leftover[oi].name)
      const last = lastNameHintScore(name, leftover[oi].name)
      if (full < 0.5 && last < 0.88) continue
      candidates.push({ slot, oi, score: Math.max(full, last) })
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const usedSlot = new Set<number>()
  const usedOcr = new Set<number>()
  const hits = new Map<number, MemberRow>()
  for (const c of candidates) {
    if (usedSlot.has(c.slot) || usedOcr.has(c.oi)) continue
    usedSlot.add(c.slot)
    usedOcr.add(c.oi)
    hits.set(c.slot, leftover[c.oi])
  }

  return members.map((m, i) => {
    const slot = missingIdx.indexOf(i)
    if (slot < 0) return m
    const hit = hits.get(slot)
    if (!hit) return m
    return rowFromOcrHit(m.name, hit, m.rowIndex)
  })
}

function missingPlaceholder(name: string, rowIndex: number): MemberRow {
  return hydrateMemberRow({
    rowIndex,
    name,
    familyCount: null,
    coverage: '',
    status: '',
    medicalPlan: '',
    medicalCurrentCharge: null,
    page: 0,
    flags: [NOT_FOUND_FLAG],
    ocrName: '',
    nameField: { raw: '', value: name, confidence: null, status: 'ok' },
  })
}

/** One output row per known member; monthly fields come from the best OCR hit. */
export function applyMemberRoster(roster: string[], ocrRows: MemberRow[]): MemberRow[] {
  const { matched } = assignRosterMatches(roster, ocrRows)
  return roster.map((name, i) => {
    const hit = matched.get(i)
    if (!hit) return missingPlaceholder(name, i + 1)
    return rowFromOcrHit(name, hit, i + 1)
  })
}

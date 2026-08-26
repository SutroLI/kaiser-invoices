import type { ExtractedAmountField, ExtractedTextField, FieldStatus, MemberRow } from '../types'
import { extractMoney, parseMoney } from './parseMembershipText'

export function interpretName(raw: string, confidence: number | null): ExtractedTextField {
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (!collapsed) {
    return { raw: '', value: '', confidence, status: 'missing' }
  }
  const value = collapsed.toUpperCase()
  const letters = (value.match(/[A-Z]/g) ?? []).length
  if (letters < 3) {
    return { raw: collapsed, value, confidence, status: 'needs-review' }
  }
  const confOk = confidence == null || confidence >= 65
  const hasComma = value.includes(',')
  const status: FieldStatus = confOk && hasComma && letters >= 6 ? 'ok' : 'needs-review'
  return { raw: collapsed, value, confidence, status }
}

export function interpretAmount(raw: string, confidence: number | null): ExtractedAmountField {
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (!collapsed) {
    return { raw: '', value: null, confidence, status: 'missing' }
  }
  const value = extractMoney(collapsed) ?? parseMoney(collapsed)
  if (value == null || Number.isNaN(value)) {
    return { raw: collapsed, value: null, confidence, status: 'needs-review' }
  }
  const plausible = value === 0 || (Math.abs(value) >= 50 && Math.abs(value) <= 8000)
  const confOk = confidence == null || confidence >= 70
  const status: FieldStatus = plausible && confOk ? 'ok' : 'needs-review'
  return { raw: collapsed, value, confidence, status }
}

export function looksLikeNonMemberLabel(name: string): boolean {
  const n = name.trim().toUpperCase()
  if (!n) return false
  return /^(NAME|FAMILY COUNT|SUBTOTAL|TOTAL |PAGE |N\/A|NA|MEMBERSHIP DETAIL|CURRENT COVERAGE|STD\b)/.test(
    n,
  )
}

export function flagsForRow(row: Pick<MemberRow, 'nameField' | 'amountField' | 'coverage' | 'status' | 'medicalPlan' | 'familyCount'>): string[] {
  const flags: string[] = []
  if (row.nameField.status === 'missing') flags.push('Missing name')
  else if (row.nameField.status === 'needs-review') flags.push('Name needs review')
  if (row.amountField.status === 'missing') flags.push('Missing medical current charge')
  else if (row.amountField.status === 'needs-review') flags.push('Charge needs review')
  if (!row.coverage) flags.push('Missing coverage')
  if (!row.status) flags.push('Missing status')
  if (!row.medicalPlan) flags.push('Missing medical plan')
  if (row.familyCount == null) flags.push('Missing family count')
  return flags
}

export function completenessWarnings(input: {
  visualRows: number
  namedRows: number
  rowsWithAmount: number
  amountSum: number
  invoiceTotal: number | null
}): string[] {
  const warnings: string[] = []
  if (input.visualRows > 0 && input.namedRows < input.visualRows) {
    warnings.push(
      `Detected ${input.visualRows} visual table rows but only ${input.namedRows} have a readable name — review blank/garbled rows before export.`,
    )
  }
  if (input.visualRows > 0 && input.rowsWithAmount < input.visualRows) {
    warnings.push(
      `${input.visualRows - input.rowsWithAmount} detected row(s) have no usable current charge.`,
    )
  }
  if (input.invoiceTotal != null && input.rowsWithAmount > 0) {
    const delta = Math.abs(input.amountSum - input.invoiceTotal)
    if (delta >= 1) {
      warnings.push(
        `Current charges sum to ${input.amountSum.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} but the invoice total due is ${input.invoiceTotal.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}. Retro activity often explains a gap — do not auto-correct; review the highlighted rows.`,
      )
    }
  }
  return warnings
}

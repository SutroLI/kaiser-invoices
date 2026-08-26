import { describe, expect, it } from 'vitest'
import { completenessWarnings, interpretAmount, interpretName, looksLikeNonMemberLabel } from './extractedFields'

describe('interpretAmount', () => {
  it('normalizes currency strings', () => {
    expect(interpretAmount('$1,234.56', 94)).toMatchObject({
      value: 1234.56,
      status: 'ok',
    })
    expect(interpretAmount('1,234.56', 90)).toMatchObject({
      value: 1234.56,
      status: 'ok',
    })
  })

  it('keeps the raw OCR text instead of dropping a row when the amount is unreadable', () => {
    const field = interpretAmount('abc', 40)
    expect(field.raw).toBe('abc')
    expect(field.value).toBeNull()
    expect(field.status).toBe('needs-review')
  })

  it('marks an empty crop as missing rather than inventing zero', () => {
    expect(interpretAmount('   ', null)).toMatchObject({
      value: null,
      status: 'missing',
    })
  })
})

describe('interpretName', () => {
  it('does not invent a comma-separated name', () => {
    const field = interpretName('M4RIA G0NZALEZ', 72)
    expect(field.value).toBe('M4RIA G0NZALEZ')
    expect(field.status).toBe('needs-review')
  })

  it('keeps a blank name as missing', () => {
    expect(interpretName('', 10).status).toBe('missing')
  })
})

describe('completenessWarnings', () => {
  it('warns when visual rows outnumber readable names', () => {
    const warnings = completenessWarnings({
      visualRows: 28,
      namedRows: 25,
      rowsWithAmount: 25,
      amountSum: 9400,
      invoiceTotal: 10150,
    })
    expect(warnings.some((w) => w.includes('28 visual table rows'))).toBe(true)
    expect(warnings.some((w) => w.includes('$9,400'))).toBe(true)
  })
})

describe('looksLikeNonMemberLabel', () => {
  it('flags subtotal/header labels for optional CSV exclude, not deletion', () => {
    expect(looksLikeNonMemberLabel('SUBTOTAL FOR BILL GROUP')).toBe(true)
    expect(looksLikeNonMemberLabel('BUCKLEY, CALEB J')).toBe(false)
  })
})

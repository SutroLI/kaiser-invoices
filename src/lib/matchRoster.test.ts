import { describe, expect, it } from 'vitest'
import { parseMembershipRows } from './parseMembershipText'
import { applyMemberRoster, rosterMatchScore } from './matchRoster'
import { formatRosterName, parseMemberRoster } from './memberRoster'

describe('rosterMatchScore', () => {
  it('maps mangled OCR names onto the known subscriber', () => {
    expect(rosterMatchScore('DIBBLE, SEAN', 'DBBLE, SEAN')).toBeGreaterThan(0.7)
    expect(rosterMatchScore('MILLER, WENDY W', 'MLLER, WENDYW')).toBeGreaterThan(0.7)
    expect(rosterMatchScore('ZAIKINE-SINCLAIR, ANASTASIA', 'ZAKINESINGLAR, ANASTASIA')).toBeGreaterThan(
      0.65,
    )
    expect(rosterMatchScore('SULLIVAN, ANDREW P', 'SULLI, VANAANDREWP')).toBeGreaterThan(0.58)
    expect(rosterMatchScore('ROOS, KAREN', 'MOOSS, GREN')).toBeGreaterThan(0.58)
    expect(rosterMatchScore('ALZAMORA, ARACELLY M', 'GALLARDO ALZAMORA, ARACELLY')).toBeGreaterThan(
      0.7,
    )
  })

  it('does not attach junk OCR to an unrelated person', () => {
    expect(rosterMatchScore('BUCKLEY, CALEB J', 'PUODEV, EAESS')).toBeLessThan(0.5)
    expect(rosterMatchScore('CONE, ARI M', 'CREE, RTE')).toBeLessThan(0.58)
  })
})

describe('applyMemberRoster', () => {
  it('keeps roster names and fills monthly fields from OCR', () => {
    const ocr = parseMembershipRows(
      `
DBBLE, SEAN 1 N XXX-XX-6718 E A DHMO $972.00 $0.00 $972.00
MLLER, WENDYW 0 N XXX-XX-2106 T DHMO $0.00 08/2026 MEDICAL $2216.00
`,
      3,
    )
    const rows = applyMemberRoster(['DIBBLE, SEAN', 'MILLER, WENDY W', 'WINFIELD, JONATHAN F'], ocr)
    expect(rows).toHaveLength(3)
    expect(rows[0].name).toBe('DIBBLE, SEAN')
    expect(rows[0].ocrName).toMatch(/DIBBLE|DBBLE/)
    expect(rows[0].medicalCurrentCharge).toBe(972)
    expect(rows[0].coverage).toBe('E')
    expect(rows[1].name).toBe('MILLER, WENDY W')
    expect(rows[1].status).toBe('T')
    expect(rows[1].medicalCurrentCharge).toBe(0)
    expect(rows[2].name).toBe('WINFIELD, JONATHAN F')
    expect(rows[2].flags).toContain('Not found on this invoice')
    expect(rows[2].medicalCurrentCharge).toBeNull()
  })

  it('emits one row per roster name even when OCR finds nobody', () => {
    const rows = applyMemberRoster(['ALZAMORA, ARACELLY M', 'COWHAM, ANGELA', 'DIBBLE, SEAN'], [])
    expect(rows.map((r) => r.name)).toEqual([
      'ALZAMORA, ARACELLY M',
      'COWHAM, ANGELA',
      'DIBBLE, SEAN',
    ])
    expect(rows.every((r) => r.flags.includes('Not found on this invoice'))).toBe(true)
  })
})

describe('formatRosterName', () => {
  it('normalizes LAST, FIRST and rejects names without a comma', () => {
    expect(formatRosterName('Roos, Karen')).toBe('ROOS, KAREN')
    expect(formatRosterName('  zaikine-sinclair,  anastasia ')).toBe('ZAIKINE-SINCLAIR, ANASTASIA')
    expect(formatRosterName('WINFIELD')).toBeNull()
    expect(formatRosterName('A, B')).toBeNull()
  })
})

describe('parseMemberRoster', () => {
  it('reads the Name column from an exported Kaiser CSV', () => {
    const names = parseMemberRoster(`File Name,Bill Period,Name,Family Count
a.pdf,September 2026,"BUCKLEY, CALEB J",1
a.pdf,September 2026,"CONE, ARI M",4
`)
    expect(names).toEqual(['BUCKLEY, CALEB J', 'CONE, ARI M'])
  })

  it('reads a plain last-first list', () => {
    expect(parseMemberRoster('Roos, Karen\nWinfield, Jonathan F\n')).toEqual([
      'ROOS, KAREN',
      'WINFIELD, JONATHAN F',
    ])
  })
})

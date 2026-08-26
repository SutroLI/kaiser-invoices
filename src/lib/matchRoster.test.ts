import { describe, expect, it } from 'vitest'
import { parseMembershipRows } from './parseMembershipText'
import { applyMemberRoster, ignoredOcrWarning, leftoverOcrAfterFill, rosterMatchScore, unusedOcrRows } from './matchRoster'
import { DEFAULT_MEMBER_ROSTER, formatRosterName, mergeRosterNames, parseMemberRoster } from './memberRoster'

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

  it('matches OCR names with junk stuck in front of the last name', () => {
    expect(rosterMatchScore('DIBBLE, SEAN', 'EE DIBBLE, SEAN')).toBeGreaterThan(0.7)
    expect(rosterMatchScore('OSPINA, SIDONIE', 'ON OSPINA, SIDONIE')).toBeGreaterThan(0.7)
    expect(rosterMatchScore('OSPINA, SIDONIE', 'LOSPNA, SIDONE AN')).toBeGreaterThan(0.58)
    expect(rosterMatchScore('ALZAMORA, ARACELLY M', 'SC SE ALZAMORA, ARAGELLY')).toBeGreaterThan(0.7)
    expect(rosterMatchScore('ALZAMORA, ARACELLY M', 'BER A SALSA ALZAMORA, ARACELLY M')).toBeGreaterThan(
      0.7,
    )
    expect(rosterMatchScore('GRIGGS, JANE H', 'I TY GRIGGS, JANE')).toBeGreaterThan(0.7)
    expect(rosterMatchScore('PAYNE, STEPHEN D', 'ACU. PAYNE, STEPHEND A')).toBeGreaterThan(0.65)
    expect(rosterMatchScore('RAINSFORD, MELISSA N', 'BSS.Y RAINSFORD, MELISSA')).toBeGreaterThan(0.7)
    expect(rosterMatchScore('SANCHEZ, CECILIA', 'DO SEO SUED SANCHEZ, CECILIA')).toBeGreaterThan(0.7)
  })

  it('does not attach junk OCR to an unrelated person', () => {
    expect(rosterMatchScore('BUCKLEY, CALEB J', 'PUODEV, EAESS')).toBeLessThan(0.5)
    expect(rosterMatchScore('CONE, ARI M', 'CREE, RTE')).toBeLessThan(0.58)
    expect(rosterMatchScore('DIBBLE, SEAN', 'MOSES, GATE')).toBeLessThan(0.58)
    expect(rosterMatchScore('HOBBS, BAILEE', 'SAER, OO')).toBeLessThan(0.58)
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

  it('fills the roster from OCR names with leading junk and hides those as unmatched', () => {
    const ocr = parseMembershipRows(
      `
EE DIBBLE, SEAN 1 N XXX-XX-6718 E A DHMO $972.00 $0.00 $972.00
I TY GRIGGS, JANE 4 N XXX-XX-9296 ESD A DHMO $1,520.00 $0.00 $1,520.00
DO SEO SUED SANCHEZ, CECILIA 1 N XXX-XX-8926 E A DHMO $1,512.00 $0.00 $1,512.00
MOSES, GATE 1 N XXX-XX-0000 E A DHMO $676.00 $0.00 $676.00
`,
      3,
    )
    const roster = ['DIBBLE, SEAN', 'GRIGGS, JANE H', 'SANCHEZ, CECILIA', 'COWHAM, ANGELA']
    const rows = applyMemberRoster(roster, ocr)
    expect(rows.find((r) => r.name === 'DIBBLE, SEAN')?.medicalCurrentCharge).toBe(972)
    expect(rows.find((r) => r.name === 'GRIGGS, JANE H')?.medicalCurrentCharge).toBe(1520)
    expect(rows.find((r) => r.name === 'SANCHEZ, CECILIA')?.medicalCurrentCharge).toBe(1512)
    expect(rows.find((r) => r.name === 'COWHAM, ANGELA')?.flags).toContain('Not found on this invoice')
    const leftover = leftoverOcrAfterFill(rows, unusedOcrRows(roster, ocr))
    expect(leftover.some((r) => /DIBBLE|GRIGGS|SANCHEZ/.test(r.name))).toBe(false)
    expect(leftover.some((r) => /MOSES/.test(r.name))).toBe(true)
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

describe('DEFAULT_MEMBER_ROSTER', () => {
  it('includes Roos and Schiller', () => {
    expect(DEFAULT_MEMBER_ROSTER).toContain('ROOS, KAREN')
    expect(DEFAULT_MEMBER_ROSTER).toContain('SCHILLER, MINDY')
  })
})

describe('mergeRosterNames', () => {
  it('adds missing names without duplicating', () => {
    expect(mergeRosterNames(['BUCKLEY, CALEB J'], ['ROOS, KAREN', 'BUCKLEY, CALEB J'])).toEqual([
      'BUCKLEY, CALEB J',
      'ROOS, KAREN',
    ])
  })
})

describe('ignoredOcrWarning', () => {
  it('names the OCR rows that did not match the list', () => {
    expect(
      ignoredOcrWarning([
        { name: 'PUODEV, EAESS' } as never,
        { name: 'CREE, RTE' } as never,
      ]),
    ).toBe(
      '2 OCR rows did not match the member list and were ignored: PUODEV, EAESS; CREE, RTE',
    )
  })
})

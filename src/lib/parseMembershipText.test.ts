import { describe, expect, it } from 'vitest'
import { invoicesToCsv } from './exportCsv'
import { SAMPLE_OCR_PAGE3, SAMPLE_OCR_PAGE4 } from './ocrFixtures'
import page7Scan from './page7-ocr.txt?raw'
import {
  extractMoney,
  extractMoneyFromLine,
  looksLikeFullMembershipTable,
  looksLikeOverflowMembershipPage,
  isMembershipDetailText,
  parseInvoiceMeta,
  parseMembershipRows,
  parseMoney,
} from './parseMembershipText'
import type { ProcessedKaiserInvoice } from '../types'

const PAGE3 = `
Membership Detail for Group ID 647388 Bill Group ID 0001 - Bill Group Name - SACRAMENTO WALDORF S/D30-150
Current coverage month 09/01/2026 - 09/30/2026 for Subgroup ID 1 Retro activity
Name Family Count Medicare assignment Y/N Subscriber ID Coverage Status Medical plan Medical current charge Period Code Amount Total Due
BUCKLEY, CALEB J 1 N XXX-XX-5314 E A DHMO $783.00 $0.00 $783.00
CONE, ARI M 4 N XXX-XX-1262 ESD A DHMO $2,216.00 $0.00 $2,216.00
HOBBS, BAILEE 3 N XXX-XX-0294 ED A DHMO $876.00 $0.00 $876.00
HOUGHTON, DAPHNE E 4 N XXX-XX-8821 ESD T DHMO $0.00 08/2026 MEDICAL $-1,072.00 $-2,144.00
08/2026 MEDICAL $-1,072.00
KNAUSENBERGER, CLARA 1 N XXX-XX-4410 E A DHMO $434.00 $0.00 $434.00
RODRIGUEZ, ELOISA M 0 N XXX-XX-2342 ESD T DHMO $0.00 08/2026 MEDICAL $-1,246.00 $-1,246.00
ROOS, KAREN 3 N XXX-XX-4331 ESD A DHMO $2,216.00 $0.00 $2,216.00
WINFIELD, JONATHAN F 2 N XXX-XX-4754 ES A DHMO $3,447.00 02/2025 MEDICAL $-2,555.00 $892.00
`

const PAGE4 = `
SACRAMENTO WALDORF SCHOOL
Consolidated Billing ID: 3220380045
Statement ID: 322038019686
Invoice Date: 08/10/2026
Bill Period: September 2026
ZAIKINE-SINCLAIR, ANASTASIA 2 N XXX-XX-8528 ES A DHMO $1,196.00 $0.00 $1,196.00
Subtotal $35,426.00 $-10,204.00 $25,222.00
Subtotal for Bill Group ID 0001
Total Current Activity $35,426.00
Membership Detail for Group ID 647388 Bill Group ID 7001 - Bill Group Name - SACRAMENTO WAL/D30-150/COBR
N/A 0 N N/A E A DHMO $0.00 $0.00 $0.00
Subtotal for Bill Group ID 7001
Total Current Activity $0.00
`

describe('parseMembershipRows', () => {
  it('extracts subscriber rows from a membership detail page', () => {
    const rows = parseMembershipRows(PAGE3, 3)
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]))

    expect(byName['BUCKLEY, CALEB J']).toMatchObject({
      familyCount: 1,
      coverage: 'E',
      status: 'A',
      medicalPlan: 'DHMO',
      medicalCurrentCharge: 783,
      page: 3,
    })
    expect(byName['CONE, ARI M']).toMatchObject({
      familyCount: 4,
      coverage: 'ESD',
      medicalCurrentCharge: 2216,
    })
    expect(byName['HOBBS, BAILEE']).toMatchObject({
      coverage: 'ED',
      familyCount: 3,
      medicalCurrentCharge: 876,
    })
    expect(byName['HOUGHTON, DAPHNE E']).toMatchObject({
      status: 'T',
      medicalCurrentCharge: 0,
    })
    expect(byName['WINFIELD, JONATHAN F']).toMatchObject({
      coverage: 'ES',
      medicalCurrentCharge: 3447,
    })
  })

  it('does not treat retro-activity continuation lines as extra people', () => {
    const rows = parseMembershipRows(PAGE3, 3)
    expect(rows.filter((r) => /HOUGHTON/.test(r.name))).toHaveLength(1)
  })

  it('picks up the leftover subscriber on the following page and skips N/A COBRA rows', () => {
    const rows = parseMembershipRows(PAGE4, 4)
    expect(rows.map((r) => r.name)).toEqual(['ZAIKINE-SINCLAIR, ANASTASIA'])
    expect(rows[0]).toMatchObject({
      familyCount: 2,
      coverage: 'ES',
      status: 'A',
      medicalPlan: 'DHMO',
      medicalCurrentCharge: 1196,
      page: 4,
    })
  })

  it('rejects legend-page OCR garbage that looks like comma-separated codes', () => {
    const rows = parseMembershipRows(
      `
Medical Plan Legend
Coverage Type Status Activity
E Employee Only
EE, EE A ET TE I
IEE, ET A EE A EE
BANE MRAFSH T
`,
      6,
    )
    expect(rows).toEqual([])
  })

  it('rejects cover-page phrases that OCR turned into names', () => {
    const rows = parseMembershipRows(
      `
Please pay this Amount $25,222.00
BALA, NCE $0.00
PLEASE, PAY $25222.00
EMPLO, YEE ET EE $9356.00
BUCKLEY, CALEB J 1 N XXX-XX-5314 E A DHMO $783.00 $0.00 $783.00
`,
      1,
    )
    expect(rows.map((r) => r.name)).toEqual(['BUCKLEY, CALEB J'])
  })

  it('detects membership detail pages', () => {
    expect(isMembershipDetailText(PAGE3)).toBe(true)
    expect(isMembershipDetailText('About Your Bill Send Payments to Kaiser')).toBe(false)
    expect(isMembershipDetailText('Medical Plan Legend Coverage Type Employee Only')).toBe(false)
  })

  it('treats a leftover page as overflow so the previous page is still read', () => {
    expect(looksLikeOverflowMembershipPage(PAGE4)).toBe(true)
    expect(looksLikeFullMembershipTable(PAGE3)).toBe(true)
    expect(looksLikeFullMembershipTable(PAGE4)).toBe(false)
  })

  it('does not swallow coverage codes into the first name', () => {
    const rows = parseMembershipRows(
      'HOBBS, BAILEE OOTXCOZES ED A DHMO $876.00 $0.00 $876.00',
      3,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('HOBBS, BAILEE')
    expect(rows[0].coverage).toBe('ED')
    expect(rows[0].medicalCurrentCharge).toBe(876)
  })

  it('uses $0.00 current charge on terminated rows instead of retro MEDICAL amounts', () => {
    const rows = parseMembershipRows(
      'HOUGHTON, DAPHNE E 4 N XXX-XX-8821 ESD T DHMO $0.00 08/2026 MEDICAL $-1,072.00 $-2,144.00',
      3,
    )
    expect(rows[0].medicalPlan).toBe('DHMO')
    expect(rows[0].status).toBe('T')
    expect(rows[0].medicalCurrentCharge).toBe(0)
  })

  it('merges OCR duplicate spellings of the same leftover subscriber', () => {
    const rows = parseMembershipRows(
      `
ZAKINESINGLAR, ANASTASIA 2 N XXX-XX-8528 ES A DHMO $119.00 $0.00 $119.00
ZAKINESINCLAIR, ANASTASIA 2 N XXX-XX-8528 ES A DHMO $1,196.00
`,
      4,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].medicalCurrentCharge).toBe(1196)
  })
})

describe('parseInvoiceMeta', () => {
  it('reads header fields', () => {
    const meta = parseInvoiceMeta(PAGE4)
    expect(meta.billingId).toBe('3220380045')
    expect(meta.statementId).toBe('322038019686')
    expect(meta.invoiceDate).toBe('08/10/2026')
    expect(meta.billPeriod).toBe('September 2026')
  })
})

describe('parseMoney', () => {
  it('handles Kaiser money formatting', () => {
    expect(parseMoney('$2,216.00')).toBe(2216)
    expect(parseMoney('$-1,072.00')).toBe(-1072)
  })
})

describe('extractMoneyFromLine', () => {
  it('recovers charges from noisy OCR', () => {
    expect(extractMoneyFromLine('[BUCKLEY,CALEBS | 1 | E | A | owmo ~~ $78300]')).toContain(783)
    expect(extractMoneyFromLine('[CONE ARIM | 4 | esp | A | $2216.00]')).toContain(2216)
    expect(extractMoneyFromLine('[GRAY.MARANNEK | 1 | E | A | $1.24600]')).toContain(1246)
    expect(extractMoneyFromLine('[REYERJOAN | 4 | $1.357.00]')).toContain(1357)
    expect(extractMoneyFromLine('BUCKLEY, CALEBJ 1 N E A DHMO $783 .00 $0.00 $783.00')).toContain(783)
    expect(extractMoneyFromLine('HOSLER,JACOB H 5 N ESD A DHMO $1 , 800.00 $0.00 $1,800 .00')).toContain(1800)
    expect(extractMoney('$1.24600')).toBe(1246)
    expect(extractMoney('$78300')).toBe(783)
    expect(extractMoney('$1.357')).toBe(1357)
    expect(extractMoney('$1.196')).toBe(1196)
    expect(extractMoney('$1.35')).toBeNull()
    expect(extractMoney('$1.19')).toBeNull()
  })
})

describe('OCR of a scanned Membership Detail table', () => {
  it('recovers fused OCR names like DIBBLESEAN', () => {
    const rows = parseMembershipRows(
      'DIBBLESEAN | 1 | N | ooxxers | E | A | ommo | $972.00',
      3,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('DIBBLE, SEAN')
    expect(rows[0].familyCount).toBe(1)
    expect(rows[0].coverage).toBe('E')
    expect(rows[0].medicalCurrentCharge).toBe(972)
  })

  it('parses a live Tesseract dump of the membership table page', () => {
    expect(isMembershipDetailText(page7Scan)).toBe(true)
    const rows = parseMembershipRows(page7Scan, 7)
    expect(rows.length).toBeGreaterThanOrEqual(15)
    const buckley = rows.find((r) => /BUCKLEY/.test(r.name))
    expect(buckley?.coverage).toBe('E')
    expect(buckley?.status).toBe('A')
    expect(buckley?.medicalPlan).toBe('DHMO')
    expect(buckley?.familyCount).toBe(1)
    expect(buckley?.medicalCurrentCharge).toBe(783)
    const cone = rows.find((r) => /CONE/.test(r.name))
    expect(cone?.familyCount).toBe(4)
    expect(cone?.medicalCurrentCharge).toBe(2216)
    const withCharge = rows.filter((r) => r.medicalCurrentCharge != null)
    expect(withCharge.length).toBeGreaterThanOrEqual(12)
  })

  it('parses a row with spaces inside money', () => {
    const rows = parseMembershipRows(
      'BUCKLEY, CALEBJ 1 N XXX-XX-5314 E A DHMO $783 .00 $0.00 $783.00\nHOSLER,JACOB H 5 N XXX-XX-0176 ESD A DHMO $1 , 800.00 $0.00 $1,800 .00',
      7,
    )
    const buckley = rows.find((r) => /BUCKLEY/.test(r.name))
    expect(buckley?.familyCount).toBe(1)
    expect(buckley?.medicalCurrentCharge).toBe(783)
    const hosler = rows.find((r) => /HOSLER/.test(r.name))
    expect(hosler?.familyCount).toBe(5)
    expect(hosler?.medicalCurrentCharge).toBe(1800)
  })

  it('does not fuse two subscriber rows when an amount is split across lines', () => {
    const rows = parseMembershipRows(
      `HOSLER, JACOB H 5 N XXX-XX-0176 ESD A DHMO $1,
800.00 $0.00 $1,800.00
HOUGHTON, DAPHNE E 0 N XXX-XX-0765 T DHMO $0.00`,
      7,
    )
    expect(rows.find((r) => /HOUGHTON/.test(r.name))).toBeTruthy()
    expect(rows.find((r) => /HOSLER/.test(r.name))).toBeTruthy()
  })

  it('parses SCHILLER and SARRADET from spaced OCR lines', () => {
    const rows = parseMembershipRows(
      `SCHILLER, MINDY 3 N XXX-XX-3971 ED A DHMO $917.00 $0.00 $917.00
SARRADET, INA M 1 N XXX-XX-1865 E A DHMO $1,512.00 $0.00 $1,512.00`,
      7,
    )
    expect(rows.find((r) => /SCHILLER/.test(r.name))?.medicalCurrentCharge).toBe(917)
    expect(rows.find((r) => /SARRADET/.test(r.name))?.medicalCurrentCharge).toBe(1512)
  })

  it('recovers subscriber names and the leftover page-4 row', () => {
    const page3 = parseMembershipRows(SAMPLE_OCR_PAGE3, 3)
    const page4 = parseMembershipRows(SAMPLE_OCR_PAGE4, 4)
    const names = [...page3, ...page4].map((r) => r.name)

    expect(names).toContain('BUCKLEY, CALEB J')
    expect(names).toContain('DIBBLE, SEAN')
    expect(names).toContain('HOUGHTON, DAPHNE E')
    expect(names).toContain('KNAUSENBERGER, CLARA')
    expect(names).toContain('SIMMS, KHALEHLA')
    expect(names).toContain('WINFIELD, JONATHAN F')
    expect(names.some((n) => /ZAKINE-SINCLAIR|ZAIKINE-SINCLAIR/.test(n))).toBe(true)
    expect(names.some((n) => n.includes('N/A') || n.startsWith('SUBTOTAL'))).toBe(false)
    expect(page3.length).toBeGreaterThanOrEqual(20)

    const buckley = page3.find((r) => r.name === 'BUCKLEY, CALEB J')
    expect(buckley?.coverage).toBe('E')
    expect(buckley?.status).toBe('A')
    expect(buckley?.medicalPlan).toBe('DHMO')
    expect(buckley?.familyCount).toBe(1)

    const houghton = page3.find((r) => r.name === 'HOUGHTON, DAPHNE E')
    expect(houghton?.status).toBe('T')
    expect(houghton?.medicalCurrentCharge).toBe(0)

    const zaikine = page4[0]
    expect(zaikine.coverage).toBe('ES')
    expect(zaikine.status).toBe('A')
    expect(zaikine.familyCount).toBe(2)
    expect(zaikine.medicalCurrentCharge).toBe(1196)
  })
})

describe('invoicesToCsv', () => {
  it('writes one CSV row per member with Wendy’s columns', () => {
    const invoice: ProcessedKaiserInvoice = {
      fileName: 'SWSA- Kaiser SEP26.pdf',
      meta: {
        customerName: 'SACRAMENTO WALDORF SCHOOL',
        billingId: '3220380045',
        statementId: '322038019686',
        invoiceDate: '08/10/2026',
        billPeriod: 'September 2026',
        dueDate: '09/01/2026',
        totalAmountDue: 25222,
      },
      members: parseMembershipRows(PAGE3, 3).concat(parseMembershipRows(PAGE4, 4)),
      pageCount: 10,
      membershipPages: [3, 4],
      usedOcr: true,
      errors: [],
      warnings: [],
      debugPages: [],
      completeness: null,
      preprocess: 'contrast',
      unmatchedOcr: [],
    }
    const csv = invoicesToCsv([invoice])
    expect(csv).toContain(
      'Name,Family Count,Coverage,Status,Medical Plan,Medical current charge,Statement ID,File Name,Bill Period',
    )
    expect(csv).toContain('ZAIKINE-SINCLAIR, ANASTASIA')
    expect(csv).toContain('1196.00')
    expect(csv).not.toContain('N/A')
  })

  it('omits rows the user unchecked from CSV but keeps them in extraction', () => {
    const members = parseMembershipRows(PAGE3, 3)
    members[0].excluded = true
    const invoice: ProcessedKaiserInvoice = {
      fileName: 'SWSA- Kaiser SEP26.pdf',
      meta: {
        customerName: '',
        billingId: '',
        statementId: '',
        invoiceDate: '',
        billPeriod: '',
        dueDate: '',
        totalAmountDue: null,
      },
      members,
      pageCount: 3,
      membershipPages: [3],
      usedOcr: false,
      errors: [],
      warnings: [],
      debugPages: [],
      completeness: null,
      preprocess: 'contrast',
      unmatchedOcr: [],
    }
    const csv = invoicesToCsv([invoice])
    expect(members[0].name).toBe('BUCKLEY, CALEB J')
    expect(csv).not.toContain('BUCKLEY, CALEB J')
    expect(csv).toContain('CONE, ARI M')
  })
})

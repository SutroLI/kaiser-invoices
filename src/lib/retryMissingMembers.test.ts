import { describe, expect, it } from 'vitest'
import { findNameHint, memberFromRetryText, rowStripRect } from './retryMissingMembers'
import { applyMemberRoster, fillMissingFromLeftover, lastNameHintScore } from './matchRoster'
import { parseMembershipRows } from './parseMembershipText'

describe('findNameHint', () => {
  const words = [
    { text: 'BUCKLEY,', x0: 10, y0: 40, x1: 80, y1: 54 },
    { text: 'CALEB', x0: 85, y0: 40, x1: 130, y1: 54 },
    { text: 'GALLARDO', x0: 10, y0: 200, x1: 90, y1: 214 },
    { text: 'ALZAMORA,', x0: 95, y0: 200, x1: 180, y1: 214 },
    { text: 'ARACELLY', x0: 185, y0: 200, x1: 260, y1: 214 },
    { text: 'ZAKINESINGLAR,', x0: 10, y0: 400, x1: 160, y1: 416 },
    { text: 'ANASTASIA', x0: 165, y0: 400, x1: 250, y1: 416 },
  ]

  it('finds a skipped last name in first-pass word boxes', () => {
    const hint = findNameHint(words, 'ALZAMORA, ARACELLY M', 800)
    expect(hint?.hint).toMatch(/ALZAMORA/)
    expect(hint?.y0).toBe(200)
  })

  it('finds a mangled leftover subscriber', () => {
    const hint = findNameHint(words, 'ZAIKINE-SINCLAIR, ANASTASIA', 800)
    expect(hint?.y0).toBe(400)
    expect(hint?.score).toBeGreaterThan(0.56)
  })

  it('does not steal a row already claimed', () => {
    const first = findNameHint(words, 'ALZAMORA, ARACELLY M', 800)
    expect(first).not.toBeNull()
    const second = findNameHint(words, 'ALZAMORA, ARACELLY M', 800, [first!])
    expect(second).toBeNull()
  })

  it('does not attach Cone to an unrelated token', () => {
    expect(findNameHint(words, 'CONE, ARI M', 800)).toBeNull()
  })
})

describe('rowStripRect', () => {
  it('pads the word box into a full-width row crop', () => {
    const strip = rowStripRect({ score: 1, hint: 'X', y0: 100, y1: 120 }, 1000, 800)
    expect(strip.x).toBe(0)
    expect(strip.w).toBe(1000)
    expect(strip.y).toBeLessThan(100)
    expect(strip.y + strip.h).toBeGreaterThan(120)
  })
})

describe('memberFromRetryText', () => {
  it('parses a second-look line onto the roster name', () => {
    const row = memberFromRetryText(
      'COWHAM, ANGELA',
      7,
      4,
      'COWHAM, ANGELA',
      '2 N XXX-XX-1111 E A DHMO $972.00 $0.00 $972.00',
    )
    expect(row?.name).toBe('COWHAM, ANGELA')
    expect(row?.medicalCurrentCharge).toBe(972)
    expect(row?.flags.some((f) => /not found/i.test(f))).toBe(false)
  })

  it('rejects a second look that is a different person', () => {
    expect(
      memberFromRetryText(
        'COWHAM, ANGELA',
        7,
        4,
        'DIBBLE, SEAN',
        '1 N XXX-XX-6718 E A DHMO $972.00',
      ),
    ).toBeNull()
  })
})

describe('fillMissingFromLeftover', () => {
  it('uses leftover OCR for a missing last name the first pass did not fill', () => {
    const leftover = parseMembershipRows(
      `ALZAMORA, ARACELLY 1 N XXX-XX-3220 E A DHMO $800.00 $0.00 $800.00`,
      3,
    )
    const members = applyMemberRoster(['ALZAMORA, ARACELLY M', 'COWHAM, ANGELA'], [])
    expect(members.every((m) => m.flags.includes('Not found on this invoice'))).toBe(true)
    const filled = fillMissingFromLeftover(members, leftover)
    expect(filled[0].name).toBe('ALZAMORA, ARACELLY M')
    expect(filled[0].medicalCurrentCharge).toBe(800)
    expect(filled[1].flags).toContain('Not found on this invoice')
  })
})

describe('lastNameHintScore', () => {
  it('treats GALLARDO ALZAMORA as a hit for ALZAMORA', () => {
    expect(lastNameHintScore('ALZAMORA, ARACELLY M', 'GALLARDO ALZAMORA')).toBeGreaterThan(0.8)
  })
})

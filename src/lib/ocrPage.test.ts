import { describe, expect, it } from 'vitest'
import { bandRanges, linesFromOcrWords, shouldTryMoreOrientations, textFromRecognizeData, zipOcrColumns } from './ocrPage'

describe('textFromRecognizeData', () => {
  it('keeps raw Membership Detail text instead of an empty word-box rebuild', () => {
    const raw = `Membership Detail for Group ID 647388
BUCKLEY, CALEB J 1 N XXX-XX-5314 E A DHMO $783.00 $0.00 $783.00`
    const picked = textFromRecognizeData({
      text: raw,
      words: [],
      lines: [],
    })
    expect(picked).toContain('Membership Detail')
    expect(picked).toContain('BUCKLEY')
  })

  it('prefers raw text over a short word-box reconstruction', () => {
    const raw = `Membership Detail for Group ID 647388
CONE, ARI M 4 N XXX-XX-1262 ESD A DHMO $2,216.00`
    const picked = textFromRecognizeData({
      text: raw,
      words: [
        { text: 'EE', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
        { text: 'A', bbox: { x0: 12, y0: 0, x1: 20, y1: 10 } },
      ],
    })
    expect(picked).toContain('CONE, ARI M')
  })
})

describe('shouldTryMoreOrientations', () => {
  it('does not retry cover pages that already OCR cleanly', () => {
    const cover = `KAISER PERMANENTE
SACRAMENTO WALDORF SCHOOL
Consolidated Billing ID: 3220380045
Statement ID: 322038025550
Invoice Date: 04/10/2026
Bill Period: May 2026
Total Amount Due $40704.00
Please pay this Amount`
    expect(shouldTryMoreOrientations(cover)).toBe(false)
  })

  it('retries when the first pass looks like sideways table garbage', () => {
    expect(shouldTryMoreOrientations('iii ||| mm ww')).toBe(true)
  })

  it('stops once Membership Detail is readable', () => {
    expect(
      shouldTryMoreOrientations(
        'Membership Detail for Group ID 647388\nBUCKLEY, CALEB J 1 N E A DHMO $783.00',
      ),
    ).toBe(false)
  })
})

describe('linesFromOcrWords', () => {
  it('joins words on the same baseline into one row', () => {
    const line = linesFromOcrWords([
      { text: 'ROOS,', bbox: { x0: 10, y0: 40, x1: 50, y1: 52 } },
      { text: 'KAREN', bbox: { x0: 55, y0: 41, x1: 90, y1: 53 } },
      { text: '3', bbox: { x0: 120, y0: 40, x1: 128, y1: 52 } },
    ])
    expect(line).toBe('ROOS, KAREN 3')
  })
})

describe('bandRanges', () => {
  it('covers the full height with overlapping slices', () => {
    const ranges = bandRanges(1000, 5, 0.2)
    expect(ranges).toHaveLength(5)
    expect(ranges[0].top).toBe(0)
    expect(ranges[4].bottom).toBe(1000)
    expect(ranges[1].top).toBeLessThan(ranges[0].bottom)
  })
})

describe('zipOcrColumns', () => {
  it('joins a name column with an amount column', () => {
    const zipped = zipOcrColumns(
      'BUCKLEY, CALEB J 1\nCONE, ARI M 4',
      '$783.00\n$2,216.00',
    )
    expect(zipped).toContain('BUCKLEY, CALEB J 1 $783.00')
    expect(zipped).toContain('CONE, ARI M 4 $2,216.00')
  })
})

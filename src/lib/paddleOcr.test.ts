import { describe, expect, it } from 'vitest'
import { normalizePaddleTableText, paddleLooksUseful, textFromPaddle, wordsFromPaddle } from './paddleOcr'

const sample = {
  text: 'BUCKLEY, CALEB J 1 N E A DHMO $783.00',
  confidence: 0.9,
  lines: [
    [
      { text: 'BUCKLEY, CALEB J', box: { x: 10, y: 40, width: 120, height: 12 }, confidence: 0.95 },
      { text: '1', box: { x: 140, y: 41, width: 8, height: 11 }, confidence: 0.9 },
      { text: '$783.00', box: { x: 400, y: 40, width: 50, height: 12 }, confidence: 0.92 },
    ],
    [
      { text: 'CONE, ARI M', box: { x: 10, y: 60, width: 90, height: 12 }, confidence: 0.94 },
      { text: '$2,216.00', box: { x: 400, y: 60, width: 60, height: 12 }, confidence: 0.91 },
    ],
  ],
}

describe('textFromPaddle', () => {
  it('joins detected boxes into table rows', () => {
    expect(textFromPaddle(sample)).toBe(
      'BUCKLEY, CALEB J 1 $783.00\nCONE, ARI M $2,216.00',
    )
  })
})

describe('wordsFromPaddle', () => {
  it('flattens line boxes into word coordinates', () => {
    const words = wordsFromPaddle(sample)
    expect(words).toHaveLength(5)
    expect(words[0]).toMatchObject({ text: 'BUCKLEY, CALEB J', x0: 10, y0: 40, x1: 130, y1: 52 })
  })
})

describe('normalizePaddleTableText', () => {
  it('closes spaces Paddle puts in money and names', () => {
    expect(normalizePaddleTableText('HOUGHTON , DAPHNE E $1 , 072.00 $783 .00')).toBe(
      'HOUGHTON, DAPHNE E $1,072.00 $783.00',
    )
  })
})

describe('paddleLooksUseful', () => {
  it('accepts a name-and-charge table dump', () => {
    expect(paddleLooksUseful(textFromPaddle(sample))).toBe(true)
  })

  it('rejects empty or glyph noise', () => {
    expect(paddleLooksUseful('||| === mm')).toBe(false)
  })
})

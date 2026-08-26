import { describe, expect, it } from 'vitest'
import {
  columnRect,
  inkRunsFromProfile,
  selectVisualRows,
  tableCropRect,
} from './detectTableRows'

describe('inkRunsFromProfile', () => {
  it('keeps every ink band including sparse ones so rows are not dropped', () => {
    const profile = [
      ...Array(10).fill(0),
      ...Array(12).fill(0.08),
      ...Array(4).fill(0),
      ...Array(12).fill(0.09),
      ...Array(4).fill(0),
      ...Array(12).fill(0.07),
      ...Array(8).fill(0),
    ]
    const runs = inkRunsFromProfile(profile)
    expect(runs).toHaveLength(3)
    const visual = selectVisualRows(runs, profile.length)
    expect(visual).toHaveLength(3)
  })

  it('drops hairline grid ticks but not real rows', () => {
    const profile = [
      ...Array(20).fill(0.1),
      ...Array(6).fill(0),
      ...Array(2).fill(0.2),
      ...Array(6).fill(0),
      ...Array(20).fill(0.1),
    ]
    const visual = selectVisualRows(inkRunsFromProfile(profile), profile.length)
    expect(visual).toHaveLength(2)
  })
})

describe('table geometry', () => {
  it('places the name crop on the left and current charge before total due', () => {
    const table = tableCropRect(1000, 1000, 'main')
    const row = { x: table.x, y: table.y + 100, w: table.w, h: 40 }
    const name = columnRect(row, { left: 0.004, right: 0.275 })
    const amount = columnRect(row, { left: 0.54, right: 0.73 })
    expect(name.x).toBeLessThan(amount.x)
    expect(amount.x + amount.w).toBeLessThan(row.x + row.w * 0.9)
  })
})

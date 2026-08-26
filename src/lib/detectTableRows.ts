import type { Rect } from '../types'

/** Kaiser Membership Detail column fractions inside the table crop. */
export const KAISER_COLUMNS = {
  name: { left: 0.004, right: 0.275 },
  codes: { left: 0.25, right: 0.56 },
  /** Medical current charge — not Total Due on the far right. */
  amount: { left: 0.54, right: 0.73 },
} as const

export function tableCropRect(
  pageWidth: number,
  pageHeight: number,
  kind: 'main' | 'overflow',
): Rect {
  if (kind === 'overflow') {
    return {
      x: 0,
      y: pageHeight * 0.03,
      w: pageWidth,
      h: pageHeight * 0.955,
    }
  }
  return {
    x: pageWidth * 0.008,
    y: pageHeight * 0.08,
    w: pageWidth * 0.984,
    h: pageHeight * 0.905,
  }
}

export function columnRect(row: Rect, col: { left: number; right: number }): Rect {
  const x = row.x + row.w * col.left
  const w = row.w * (col.right - col.left)
  return { x, y: row.y, w, h: row.h }
}

export type InkRun = { start: number; end: number }

/** Merge dark-pixel runs on a 1-D ink profile into candidate table rows. */
export function inkRunsFromProfile(
  profile: number[],
  minInk = 0.018,
  maxGap = 3,
): InkRun[] {
  const raw: InkRun[] = []
  let start = -1
  for (let y = 0; y < profile.length; y++) {
    const on = profile[y] >= minInk
    if (on && start < 0) start = y
    if (!on && start >= 0) {
      raw.push({ start, end: y })
      start = -1
    }
  }
  if (start >= 0) raw.push({ start, end: profile.length })
  if (raw.length === 0) return []

  const merged: InkRun[] = [{ ...raw[0] }]
  for (const run of raw.slice(1)) {
    const prev = merged[merged.length - 1]
    if (run.start - prev.end <= maxGap) prev.end = run.end
    else merged.push({ ...run })
  }
  return merged
}

/**
 * Keep visually plausible data rows. Thin grid-line blips are dropped;
 * everything else is kept so OCR failure cannot delete a person.
 */
export function selectVisualRows(runs: InkRun[], tableHeight: number): InkRun[] {
  if (runs.length === 0) return []
  const heights = runs.map((r) => r.end - r.start).sort((a, b) => a - b)
  const median = heights[Math.floor(heights.length / 2)] || 16
  const minH = Math.max(8, median * 0.38)
  return runs.filter((r) => {
    const h = r.end - r.start
    if (h < minH) return false
    if (r.start > tableHeight * 0.97 && h < median * 0.8) return false
    return true
  })
}

export function padRowRect(row: Rect, table: Rect, padRatio = 0.18): Rect {
  const extra = row.h * padRatio
  const y = Math.max(table.y, row.y - extra)
  const bottom = Math.min(table.y + table.h, row.y + row.h + extra)
  return { x: row.x, y, w: row.w, h: Math.max(1, bottom - y) }
}

export function runsToRowRects(runs: InkRun[], table: Rect): Rect[] {
  return runs.map((run) =>
    padRowRect(
      {
        x: table.x,
        y: table.y + run.start,
        w: table.w,
        h: Math.max(1, run.end - run.start),
      },
      table,
    ),
  )
}

export function horizontalInkProfile(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  darkBelow = 210,
): number[] {
  const profile = new Array<number>(height).fill(0)
  for (let y = 0; y < height; y++) {
    let dark = 0
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if ((data[i] + data[i + 1] + data[i + 2]) / 3 < darkBelow) dark += 1
    }
    profile[y] = width === 0 ? 0 : dark / width
  }
  return profile
}

export function detectRowRectsFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tableOnPage: Rect,
): Rect[] {
  const profile = horizontalInkProfile(data, width, height)
  const runs = selectVisualRows(inkRunsFromProfile(profile), height)
  const localTable: Rect = { x: 0, y: 0, w: width, h: height }
  return runsToRowRects(runs, localTable).map((row) => ({
    x: tableOnPage.x + row.x,
    y: tableOnPage.y + row.y,
    w: row.w,
    h: row.h,
  }))
}

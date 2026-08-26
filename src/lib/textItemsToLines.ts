interface Positioned {
  str: string
  x: number
  y: number
  width: number
  height: number
}

function asTextItem(item: unknown): {
  str: string
  transform?: number[]
  height?: number
  width?: number
} | null {
  if (!item || typeof item !== 'object' || !('str' in item)) return null
  const rec = item as { str?: unknown; transform?: unknown; height?: unknown; width?: unknown }
  if (typeof rec.str !== 'string') return null
  return {
    str: rec.str,
    transform: Array.isArray(rec.transform) ? (rec.transform as number[]) : undefined,
    height: typeof rec.height === 'number' ? rec.height : undefined,
    width: typeof rec.width === 'number' ? rec.width : undefined,
  }
}

export function textItemsToLines(items: readonly unknown[]): string {
  const positioned: Positioned[] = []
  for (const raw of items) {
    const item = asTextItem(raw)
    if (!item?.str.trim()) continue
    const tx = item.transform ?? null
    const x = tx ? tx[4] : 0
    const y = tx ? tx[5] : 0
    const height = item.height ?? 8
    const width = item.width ?? item.str.length * 4
    positioned.push({ str: item.str, x, y, width, height })
  }

  if (positioned.length === 0) {
    return items
      .map((raw) => asTextItem(raw)?.str ?? '')
      .filter(Boolean)
      .join('\n')
  }

  positioned.sort((a, b) => b.y - a.y || a.x - b.x)

  const lines: Positioned[][] = []
  for (const item of positioned) {
    const last = lines[lines.length - 1]
    if (!last) {
      lines.push([item])
      continue
    }
    const avgH = last.reduce((s, p) => s + p.height, 0) / last.length
    const avgY = last.reduce((s, p) => s + p.y, 0) / last.length
    if (Math.abs(item.y - avgY) <= Math.max(avgH, 6) * 0.6) {
      last.push(item)
    } else {
      lines.push([item])
    }
  }

  return lines
    .map((line) =>
      line
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n')
}

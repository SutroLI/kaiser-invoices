import { writeFileSync } from 'node:fs'
import { createWorker } from 'tesseract.js'

function linesFromWords(words) {
  const usable = (words ?? [])
    .map((w) => ({
      text: (w.text || '').trim(),
      x: w.bbox.x0,
      y: (w.bbox.y0 + w.bbox.y1) / 2,
      h: Math.max(1, w.bbox.y1 - w.bbox.y0),
    }))
    .filter((w) => w.text)
  usable.sort((a, b) => a.y - b.y || a.x - b.x)
  const rows = []
  for (const word of usable) {
    const last = rows[rows.length - 1]
    if (!last) {
      rows.push([word])
      continue
    }
    const avgY = last.reduce((s, w) => s + w.y, 0) / last.length
    const avgH = last.reduce((s, w) => s + w.h, 0) / last.length
    if (Math.abs(word.y - avgY) <= Math.max(avgH, 10) * 0.7) last.push(word)
    else rows.push([word])
  }
  return rows
    .map((r) =>
      r
        .sort((a, b) => a.x - b.x)
        .map((w) => w.text)
        .join(' '),
    )
    .join('\n')
}

const files = process.argv.slice(2)
const worker = await createWorker('eng', 1)
await worker.setParameters({
  tessedit_pageseg_mode: '6',
  preserve_interword_spaces: '1',
})

for (const file of files) {
  console.log('OCR', file)
  const { data } = await worker.recognize(file)
  const rebuilt = linesFromWords(data.words)
  const base = file.replace(/[^a-zA-Z0-9]+/g, '_').slice(-40)
  writeFileSync(`/tmp/${base}-raw.txt`, data.text || '')
  writeFileSync(`/tmp/${base}-rebuilt.txt`, rebuilt)
  console.log('raw chars', (data.text || '').length, 'rebuilt chars', rebuilt.length)
  console.log('raw head:\n', (data.text || '').slice(0, 1200))
  console.log('\nrebuilt head:\n', rebuilt.slice(0, 1200))
}

await worker.terminate()

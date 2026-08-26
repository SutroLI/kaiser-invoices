import type { OcrDebugPage } from './types'

function pct(n: number, total: number): string {
  if (!total) return '0%'
  return `${(n / total) * 100}%`
}

export default function OcrDebugPanel({ pages }: { pages: OcrDebugPage[] }) {
  if (pages.length === 0) {
    return (
      <p className="debug-empty">
        No debug overlays were captured. Turn on OCR debug, then drop the PDF again.
      </p>
    )
  }

  return (
    <div className="debug-pages">
      {pages.map((page) => (
        <div key={page.page} className="debug-page">
          <h3 className="debug-heading">
            PDF page {page.page} — {page.rows.length} detected row{page.rows.length === 1 ? '' : 's'}
          </h3>
          <p className="detail-file">
            Magenta = table · teal = row · blue = name crop · orange = current-charge crop
          </p>
          <div className="debug-overlay">
            <img src={page.previewDataUrl} alt={`OCR debug page ${page.page}`} />
            <div
              className="debug-box debug-box-table"
              style={{
                left: pct(page.tableBounds.x, page.sourceWidth),
                top: pct(page.tableBounds.y, page.sourceHeight),
                width: pct(page.tableBounds.w, page.sourceWidth),
                height: pct(page.tableBounds.h, page.sourceHeight),
              }}
            />
            {page.rows.map((row) => (
              <div key={row.rowIndex}>
                <div
                  className="debug-box debug-box-row"
                  style={{
                    left: pct(row.row.x, page.sourceWidth),
                    top: pct(row.row.y, page.sourceHeight),
                    width: pct(row.row.w, page.sourceWidth),
                    height: pct(row.row.h, page.sourceHeight),
                  }}
                >
                  <span className="debug-row-label">{row.rowIndex}</span>
                </div>
                <div
                  className="debug-box debug-box-name"
                  style={{
                    left: pct(row.name.x, page.sourceWidth),
                    top: pct(row.name.y, page.sourceHeight),
                    width: pct(row.name.w, page.sourceWidth),
                    height: pct(row.name.h, page.sourceHeight),
                  }}
                />
                <div
                  className="debug-box debug-box-amount"
                  style={{
                    left: pct(row.amount.x, page.sourceWidth),
                    top: pct(row.amount.y, page.sourceHeight),
                    width: pct(row.amount.w, page.sourceWidth),
                    height: pct(row.amount.h, page.sourceHeight),
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

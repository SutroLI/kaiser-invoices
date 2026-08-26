import type { ProcessedKaiserInvoice } from '../types'

function escapeCsv(value: string | number | null | undefined): string {
  if (value == null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

const HEADERS = [
  'File Name',
  'Bill Period',
  'Statement ID',
  'Name',
  'Family Count',
  'Coverage',
  'Status',
  'Medical Plan',
  'Medical current charge',
]

export function invoicesToCsv(invoices: ProcessedKaiserInvoice[]): string {
  const rows: string[] = []
  for (const inv of invoices) {
    if (inv.members.length === 0) {
      rows.push(
        [
          inv.fileName,
          inv.meta.billPeriod,
          inv.meta.statementId,
          '',
          '',
          '',
          '',
          '',
          '',
        ]
          .map(escapeCsv)
          .join(','),
      )
      continue
    }
    for (const m of inv.members) {
      if (m.excluded) continue
      rows.push(
        [
          inv.fileName,
          inv.meta.billPeriod,
          inv.meta.statementId,
          m.name,
          m.familyCount ?? '',
          m.coverage,
          m.status,
          m.medicalPlan,
          m.medicalCurrentCharge != null ? m.medicalCurrentCharge.toFixed(2) : '',
        ]
          .map(escapeCsv)
          .join(','),
      )
    }
  }

  return `\uFEFF${[HEADERS.join(','), ...rows].join('\n')}`
}

export function downloadCsv(invoices: ProcessedKaiserInvoice[], filename: string): void {
  const csv = invoicesToCsv(invoices)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

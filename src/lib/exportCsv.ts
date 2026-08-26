import type { ProcessedKaiserInvoice } from '../types'
import { NOT_FOUND_FLAG } from './matchRoster'

function escapeCsv(value: string | number | null | undefined): string {
  if (value == null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

const HEADERS = [
  'Name',
  'Family Count',
  'Coverage',
  'Status',
  'Medical Plan',
  'Medical current charge',
  'Statement ID',
  'File Name',
  'Bill Period',
]

export function invoicesToCsv(invoices: ProcessedKaiserInvoice[]): string {
  const rows: string[] = []
  for (const inv of invoices) {
    if (inv.members.length === 0) {
      rows.push(
        [
          '',
          '',
          '',
          '',
          '',
          '',
          inv.meta.statementId,
          inv.fileName,
          inv.meta.billPeriod,
        ]
          .map(escapeCsv)
          .join(','),
      )
      continue
    }
    for (const m of inv.members) {
      if (m.excluded) continue
      if (m.flags.includes(NOT_FOUND_FLAG)) continue
      rows.push(
        [
          m.name,
          m.familyCount ?? '',
          m.coverage,
          m.status,
          m.medicalPlan,
          m.medicalCurrentCharge != null ? m.medicalCurrentCharge.toFixed(2) : '',
          inv.meta.statementId,
          inv.fileName,
          inv.meta.billPeriod,
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

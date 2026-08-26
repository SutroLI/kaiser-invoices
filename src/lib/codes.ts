export const COVERAGE_LABELS: Record<string, string> = {
  E: 'Employee Only',
  ES: 'Employee and Spouse',
  ESD: 'Employee, Spouse and Dependent(s)',
  ED: 'Employee and Dependent(s)',
  EA: 'Employee and Adult dependent',
}

export const STATUS_LABELS: Record<string, string> = {
  A: 'Active',
  R: 'Retiree',
  C: 'Cobra',
  T: 'Terminated',
}

export const MEDICAL_PLANS = [
  'HMO PLUS',
  'SRADDHMO',
  'MSPSRADV',
  'SL&FIT',
  'SR ADV',
  'CHAC',
  'CHIRO',
  'ACCU',
  'DEPO',
  'DHMO',
  'DENTAL',
  'VISION',
  'MEDICAL',
  'HMO',
  'PPO',
  'EPO',
  'POS',
  'HSA',
  'HRA',
  'BZS',
  'BZ',
  'GDR',
  'GD',
  'SLS',
  'PT',
  'OOA',
  'CAT',
  'FIT',
  'SL',
] as const

export const COVERAGE_CODES = ['ESD', 'ED', 'ES', 'EA', 'E'] as const
export const STATUS_CODES = ['A', 'R', 'C', 'T'] as const

export function coverageLabel(code: string): string {
  if (!code) return ''
  return COVERAGE_LABELS[code] ?? code
}

export function statusLabel(code: string): string {
  if (!code) return ''
  return STATUS_LABELS[code] ?? code
}

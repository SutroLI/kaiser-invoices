export type CoverageCode = 'E' | 'ES' | 'ESD' | 'ED' | 'EA' | ''

export type FieldStatus = 'ok' | 'needs-review' | 'missing'

export type PreprocessMode = 'raw' | 'contrast' | 'binary'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface ExtractedTextField {
  raw: string
  value: string
  confidence: number | null
  status: FieldStatus
}

export interface ExtractedAmountField {
  raw: string
  value: number | null
  confidence: number | null
  status: FieldStatus
}

export interface MemberRow {
  rowIndex: number
  name: string
  familyCount: number | null
  coverage: string
  status: string
  medicalPlan: string
  medicalCurrentCharge: number | null
  page: number
  flags: string[]
  excluded: boolean
  ocrName?: string
  nameField: ExtractedTextField
  amountField: ExtractedAmountField
  debugCrops?: {
    nameDataUrl: string
    amountDataUrl: string
  }
}

export interface InvoiceMeta {
  customerName: string
  billingId: string
  statementId: string
  invoiceDate: string
  billPeriod: string
  dueDate: string
  totalAmountDue: number | null
}

export interface DebugRowBoxes {
  rowIndex: number
  row: Rect
  name: Rect
  amount: Rect
}

export interface OcrDebugPage {
  page: number
  previewDataUrl: string
  sourceWidth: number
  sourceHeight: number
  tableBounds: Rect
  rows: DebugRowBoxes[]
}

export interface CompletenessReport {
  visualRows: number
  namedRows: number
  rowsWithAmount: number
  amountSum: number
  invoiceTotal: number | null
  warnings: string[]
}

export interface ProcessedKaiserInvoice {
  fileName: string
  meta: InvoiceMeta
  members: MemberRow[]
  pageCount: number
  membershipPages: number[]
  usedOcr: boolean
  errors: string[]
  warnings: string[]
  debugPages: OcrDebugPage[]
  completeness: CompletenessReport | null
  preprocess: PreprocessMode
  unmatchedOcr: MemberRow[]
}

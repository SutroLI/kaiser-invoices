import { useCallback, useMemo, useState } from 'react'
import BrandBars, { BrandLogo } from './BrandBars'
import './App.css'
import { COVERAGE_CODES, MEDICAL_PLANS, STATUS_CODES, coverageLabel, statusLabel } from './lib/codes'
import { downloadCsv } from './lib/exportCsv'
import { ADDED_ROW_FLAG, NOT_FOUND_FLAG, ignoredOcrWarning, isMissingOnInvoice } from './lib/matchRoster'
import { DEFAULT_MEMBER_ROSTER, formatRosterName, mergeRosterNames } from './lib/memberRoster'
import { finishOcr, parseKaiserPdf } from './lib/parseKaiserPdf'
import { hydrateMemberRow, parseMoney, formatMoney } from './lib/parseMembershipText'
import type { MemberRow, ProcessedKaiserInvoice } from './types'

type FilterMode = 'all' | 'issues'

const ROSTER_KEY = 'kaiser-member-roster-v2'
const ROSTER_PATCH_KEY = 'kaiser-member-roster-patch'
const ROSTER_PATCH = 1
const ROSTER_PATCH_NAMES = ['ROOS, KAREN', 'SCHILLER, MINDY']

function persistRoster(names: string[]): void {
  localStorage.setItem(ROSTER_KEY, JSON.stringify(names))
}

function readStoredRoster(): string[] {
  let names = [...DEFAULT_MEMBER_ROSTER]
  try {
    const raw = localStorage.getItem(ROSTER_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.every((n) => typeof n === 'string' && n.trim())) {
        names = parsed.map((n) => n.trim().toUpperCase())
      }
    }
    const patch = Number(localStorage.getItem(ROSTER_PATCH_KEY) || '0')
    if (patch < ROSTER_PATCH) {
      names = mergeRosterNames(names, ROSTER_PATCH_NAMES)
      persistRoster(names)
      localStorage.setItem(ROSTER_PATCH_KEY, String(ROSTER_PATCH))
    }
  } catch {
    names = [...DEFAULT_MEMBER_ROSTER]
  }
  return names
}

type MemberPatch = Partial<
  Pick<MemberRow, 'name' | 'familyCount' | 'coverage' | 'status' | 'medicalPlan' | 'medicalCurrentCharge'>
>

function flagsAfterEdit(row: MemberRow): string[] {
  const hasMonthly =
    row.familyCount != null ||
    Boolean(row.coverage) ||
    Boolean(row.status) ||
    Boolean(row.medicalPlan) ||
    row.medicalCurrentCharge != null
  let flags = row.flags.filter((f) => f !== 'Missing medical current charge')
  if (hasMonthly) flags = flags.filter((f) => f !== NOT_FOUND_FLAG)
  if (row.medicalCurrentCharge == null) flags.push('Missing medical current charge')
  return [...new Set(flags)]
}

function App() {
  const [invoices, setInvoices] = useState<ProcessedKaiserInvoice[]>([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [roster, setRoster] = useState<string[]>(readStoredRoster)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [rosterEditing, setRosterEditing] = useState(false)
  const [newMember, setNewMember] = useState('')
  const [rosterError, setRosterError] = useState('')
  const [blankRowName, setBlankRowName] = useState('')
  const [blankRowError, setBlankRowError] = useState('')

  const applyRoster = useCallback((names: string[]) => {
    const sorted = [...names].sort((a, b) => a.localeCompare(b))
    setRoster(sorted)
    persistRoster(sorted)
  }, [])

  const addMember = useCallback(() => {
    const name = formatRosterName(newMember)
    if (!name) {
      setRosterError('Use LAST, FIRST (middle initial optional).')
      return
    }
    if (roster.includes(name)) {
      setRosterError('That person is already on the list.')
      return
    }
    setRosterError('')
    setNewMember('')
    applyRoster([...roster, name])
  }, [applyRoster, newMember, roster])

  const renameMember = useCallback(
    (from: string, raw: string) => {
      const name = formatRosterName(raw)
      if (!name || name === from) return
      if (roster.includes(name)) return
      applyRoster(roster.map((n) => (n === from ? name : n)))
    },
    [applyRoster, roster],
  )

  const removeMember = useCallback(
    (name: string) => {
      applyRoster(roster.filter((n) => n !== name))
    },
    [applyRoster, roster],
  )

  const patchMember = useCallback(
    (fileName: string, rowIndex: number, patch: MemberPatch) => {
      setInvoices((prev) =>
        prev.map((inv) => {
          if (inv.fileName !== fileName) return inv
          return {
            ...inv,
            members: inv.members.map((m) => {
              if (m.rowIndex !== rowIndex) return m
              const { nameField: _n, amountField: _a, ...rest } = m
              const next = hydrateMemberRow({ ...rest, ...patch })
              return { ...next, flags: flagsAfterEdit(next) }
            }),
          }
        }),
      )
    },
    [],
  )

  const addUnmatchedRow = useCallback(
    (fileName: string, ocrRow: MemberRow) => {
      setInvoices((prev) =>
        prev.map((inv) => {
          if (inv.fileName !== fileName) return inv
          const name =
            formatRosterName(ocrRow.name) ?? ocrRow.name.replace(/\s+/g, ' ').trim().toUpperCase()
          const rowIndex = Math.max(0, ...inv.members.map((m) => m.rowIndex)) + 1
          const { nameField: _n, amountField: _a, ...rest } = ocrRow
          const added = hydrateMemberRow({
            ...rest,
            rowIndex,
            name,
            ocrName: ocrRow.name,
            flags: [...ocrRow.flags.filter((f) => f !== NOT_FOUND_FLAG), ADDED_ROW_FLAG],
          })
          const unmatchedOcr = (inv.unmatchedOcr ?? []).filter(
            (r) => r.rowIndex !== ocrRow.rowIndex || r.name !== ocrRow.name,
          )
          const ignored = ignoredOcrWarning(unmatchedOcr)
          return {
            ...inv,
            members: [...inv.members, added],
            unmatchedOcr,
            warnings: [
              ...inv.warnings.filter((w) => !/did not match the member list/i.test(w)),
              ...(ignored ? [ignored] : []),
            ],
          }
        }),
      )
      const official = formatRosterName(ocrRow.name)
      if (official && !roster.includes(official)) applyRoster([...roster, official])
    },
    [applyRoster, roster],
  )

  const addBlankRow = useCallback(() => {
    const target = invoices[invoices.length - 1]
    if (!target) return
    const name = formatRosterName(blankRowName)
    if (!name) {
      setBlankRowError('Use LAST, FIRST (middle initial optional).')
      return
    }
    setBlankRowError('')
    setBlankRowName('')
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.fileName !== target.fileName) return inv
        if (inv.members.some((m) => m.name === name)) return inv
        const rowIndex = Math.max(0, ...inv.members.map((m) => m.rowIndex)) + 1
        const added = hydrateMemberRow({
          rowIndex,
          name,
          familyCount: null,
          coverage: '',
          status: '',
          medicalPlan: '',
          medicalCurrentCharge: null,
          page: 0,
          flags: [ADDED_ROW_FLAG],
          ocrName: '',
        })
        return { ...inv, members: [...inv.members, added] }
      }),
    )
    if (!roster.includes(name)) applyRoster([...roster, name])
  }, [applyRoster, blankRowName, invoices, roster])

  const processPdfs = useCallback(async (pdfFiles: File[], rosterNames: string[]) => {
    if (pdfFiles.length === 0) return
    setLoading(true)
    const results: ProcessedKaiserInvoice[] = []
    try {
      for (const file of pdfFiles) {
        try {
          results.push(await parseKaiserPdf(file, setProgress, { roster: rosterNames }))
        } catch (err) {
          results.push({
            fileName: file.name,
            meta: {
              customerName: '',
              billingId: '',
              statementId: '',
              invoiceDate: '',
              billPeriod: '',
              dueDate: '',
              totalAmountDue: null,
            },
            members: [],
            pageCount: 0,
            membershipPages: [],
            usedOcr: false,
            errors: [`Failed to parse: ${err instanceof Error ? err.message : String(err)}`],
            warnings: [],
            debugPages: [],
            completeness: null,
            preprocess: 'contrast',
            unmatchedOcr: [],
          })
        }
      }
    } finally {
      await finishOcr().catch(() => undefined)
      setProgress('')
      setLoading(false)
    }

    setInvoices((prev) => {
      const byKey = new Map(prev.map((inv) => [inv.fileName, inv]))
      for (const inv of results) {
        byKey.set(inv.fileName, inv)
      }
      return Array.from(byKey.values())
    })
  }, [])

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      if (roster.length === 0) {
        setRosterOpen(true)
        setRosterEditing(true)
        setRosterError('Add at least one member to the list before reading an invoice.')
        return
      }
      const pdfFiles = Array.from(files).filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      )
      if (pdfFiles.length > 0) await processPdfs(pdfFiles, roster)
    },
    [processPdfs, roster],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      void processFiles(e.dataTransfer.files)
    },
    [processFiles],
  )

  const allMembers = useMemo(
    () =>
      invoices.flatMap((inv) =>
        inv.members
          .filter((m) => !m.excluded && !isMissingOnInvoice(m))
          .map((m) => ({ inv, m })),
      ),
    [invoices],
  )

  const issueCount = useMemo(
    () => allMembers.filter(({ m, inv }) => m.flags.length > 0 || inv.errors.length > 0).length,
    [allMembers],
  )

  const errorFileCount = useMemo(
    () => invoices.filter((inv) => inv.errors.length > 0 || inv.members.length === 0).length,
    [invoices],
  )

  const chargeTotal = useMemo(
    () => allMembers.reduce((sum, { m }) => sum + (m.medicalCurrentCharge ?? 0), 0),
    [allMembers],
  )

  const displayed = useMemo(() => {
    if (filter === 'issues') {
      return allMembers.filter(({ m, inv }) => m.flags.length > 0 || inv.errors.length > 0)
    }
    return allMembers
  }, [allMembers, filter])

  const matchWarnings = invoices
    .flatMap((inv) => inv.warnings)
    .filter((w) => /not found on this invoice/i.test(w))

  const unmatchedByFile = invoices.filter((inv) => (inv.unmatchedOcr ?? []).length > 0)

  return (
    <div className="page">
      <section className="top-hero" aria-label="Sutro Li">
        <BrandBars />
        <div className="top-hero-inner">
          <div className="top-hero-brand">
            <BrandLogo />
          </div>
          <h1 className="page-title-on-bar">Kaiser Invoice Reader</h1>
        </div>
      </section>

      <div className="app">
        <div className="workflow-section">
          <div className="workflow-panel">
            <div className="panel-card panel-card-instructions">
              <p className="panel-intro">
                Drop a Kaiser PDF each month. OCR fills what it can and flags missing cells so you
                can finish from the invoice — then export.
              </p>
            </div>

            <div className="panel-card roster-card">
              <div className="roster-head">
                <button
                  type="button"
                  className="roster-toggle"
                  aria-expanded={rosterOpen}
                  onClick={() => {
                    setRosterOpen((open) => {
                      if (open) {
                        setRosterEditing(false)
                        setNewMember('')
                        setRosterError('')
                      }
                      return !open
                    })
                  }}
                >
                  <span className="roster-chevron" aria-hidden>
                    {rosterOpen ? '▼' : '▶'}
                  </span>
                  <strong>{roster.length} employees</strong>
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    if (rosterEditing) {
                      setRosterEditing(false)
                      setNewMember('')
                      setRosterError('')
                    } else {
                      setRosterOpen(true)
                      setRosterEditing(true)
                    }
                  }}
                >
                  {rosterEditing ? 'Done' : 'Edit'}
                </button>
              </div>
              {rosterOpen && (
                <>
                  {rosterEditing ? (
                    <>
                      <ul className="roster-editor">
                        {roster.map((name) => (
                          <li key={name}>
                            <input
                              className="roster-name-input"
                              defaultValue={name}
                              aria-label={`Name for ${name}`}
                              onBlur={(e) => {
                                const next = formatRosterName(e.target.value)
                                if (!next || next === name || roster.includes(next)) {
                                  e.target.value = name
                                  return
                                }
                                renameMember(name, next)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              }}
                            />
                            <button
                              type="button"
                              className="roster-remove"
                              onClick={() => removeMember(name)}
                              aria-label={`Remove ${name}`}
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                      <form
                        className="roster-add"
                        onSubmit={(e) => {
                          e.preventDefault()
                          addMember()
                        }}
                      >
                        <input
                          className="roster-name-input"
                          value={newMember}
                          onChange={(e) => {
                            setNewMember(e.target.value)
                            if (rosterError) setRosterError('')
                          }}
                          placeholder="LAST, FIRST"
                          aria-label="Add employee"
                        />
                        <button type="submit" className="btn secondary">
                          Add
                        </button>
                      </form>
                      {rosterError ? <p className="roster-error">{rosterError}</p> : null}
                    </>
                  ) : (
                    <ul className="roster-list">
                      {roster.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            <div className="panel-card panel-card-upload">
              <section
                className={`dropzone${dragOver ? ' dropzone-active' : ''}${loading ? ' dropzone-disabled' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
              >
                <input
                  type="file"
                  id="file-input"
                  accept=".pdf,application/pdf"
                  multiple
                  disabled={loading}
                  onChange={(e) => e.target.files && void processFiles(e.target.files)}
                />
                <label htmlFor="file-input" className="dropzone-label">
                  {loading ? (
                    <span className="dropzone-file">
                      {progress || 'Processing invoices…'}
                      <span className="dropzone-hint">You can switch tabs — reading keeps going.</span>
                    </span>
                  ) : (
                    <div className="dropzone-empty">
                      <img
                        src={`${import.meta.env.BASE_URL}SL-Bulb.png`}
                        alt=""
                        className="dropzone-bulb"
                        width={66}
                        height={66}
                        aria-hidden
                      />
                      <div className="dropzone-copy">
                        <span className="dropzone-title">Drop this month’s Kaiser PDF here</span>
                        <span className="dropzone-hint">
                          PDF · OCR fills what it can · click empty cells to correct · or browse
                        </span>
                      </div>
                    </div>
                  )}
                </label>
              </section>

              {invoices.length > 0 && (
                <div className="upload-actions">
                  <button type="button" className="btn secondary" onClick={() => setInvoices([])}>
                    Clear all
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() =>
                      downloadCsv(
                        invoices,
                        `kaiser-membership-${new Date().toISOString().slice(0, 10)}.csv`,
                      )
                    }
                  >
                    Export CSV
                  </button>
                </div>
              )}
            </div>
          </div>

          <p className="workflow-footer">
            Files stay in browser, no memory or backend. Click empty cells to add missing info from the invoice. Export when the table looks right.
          </p>
        </div>

        {(matchWarnings.length > 0 || unmatchedByFile.length > 0) && invoices.length > 0 && (
          <section className="completeness-banner" role="status">
            {matchWarnings.map((note) => (
              <p key={note}>{note}</p>
            ))}
            {unmatchedByFile.map((inv) => (
              <div key={`unmatched-${inv.fileName}`} className="unmatched-ocr">
                <p>
                  {inv.unmatchedOcr.length} OCR row
                  {inv.unmatchedOcr.length === 1 ? '' : 's'} did not match the member list and{' '}
                  {inv.unmatchedOcr.length === 1 ? 'was' : 'were'} ignored
                  {inv.unmatchedOcr.length === 1 ? '' : ':'}
                </p>
                <ul className="unmatched-ocr-list">
                  {inv.unmatchedOcr.map((row) => (
                    <li key={`${inv.fileName}:${row.rowIndex}:${row.name}`}>
                      <span>
                        {row.name}
                        {row.medicalCurrentCharge != null
                          ? ` · ${formatMoney(row.medicalCurrentCharge)}`
                          : ''}
                      </span>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => addUnmatchedRow(inv.fileName, row)}
                      >
                        Add row
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        )}

        {invoices.length > 0 && (
          <section className="summary-bar">
            <span>
              {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
            </span>
            <span className="stat-ready">
              {allMembers.length} member{allMembers.length !== 1 ? 's' : ''}
            </span>
            <span>{formatMoney(chargeTotal)} current charges</span>
            {errorFileCount > 0 && (
              <span className="stat-issues">
                {errorFileCount} file{errorFileCount !== 1 ? 's' : ''} need attention
              </span>
            )}
            <div className="filter-toggle">
              <button
                type="button"
                className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
                onClick={() => setFilter('all')}
              >
                Show all
              </button>
              <button
                type="button"
                className={`filter-btn ${filter === 'issues' ? 'active' : ''}`}
                onClick={() => setFilter('issues')}
                disabled={issueCount === 0 && errorFileCount === 0}
              >
                Issues only ({issueCount})
              </button>
            </div>
          </section>
        )}

        {invoices.length > 0 && (
          <section className="results card result-card">
            <h2 className="result-card-title">Click any empty cell and type what’s on the invoice</h2>
            <p className="result-card-hint">
              Yellow cells still need a look. Finish those from the invoice, then export.
            </p>
            <div className="table-wrap table-wrap-results">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Family Count</th>
                    <th>Coverage</th>
                    <th>Status</th>
                    <th>Medical Plan</th>
                    <th>Medical current charge</th>
                    <th>Bill Period</th>
                    <th>File</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.length === 0 && (
                    <tr>
                      <td colSpan={8} className="empty-filter">
                        {allMembers.length === 0
                          ? 'No membership rows were found in the uploaded PDFs.'
                          : 'No rows with issues.'}
                      </td>
                    </tr>
                  )}
                  {displayed.map(({ inv, m }) => {
                    const key = `${inv.fileName}:${m.rowIndex}`
                    const flagged = m.flags.length > 0
                    const added = m.flags.includes(ADDED_ROW_FLAG)
                    const plans = m.medicalPlan && !(MEDICAL_PLANS as readonly string[]).includes(m.medicalPlan)
                      ? [m.medicalPlan, ...MEDICAL_PLANS]
                      : MEDICAL_PLANS

                    return (
                      <tr key={key} className={flagged ? 'row-flagged' : undefined}>
                        <td>
                          {added ? (
                            <input
                              className="field-input"
                              defaultValue={m.name}
                              key={`name:${m.name}`}
                              aria-label={`Name for ${m.name}`}
                              onBlur={(e) => {
                                const next =
                                  formatRosterName(e.target.value) ??
                                  e.target.value.replace(/\s+/g, ' ').trim().toUpperCase()
                                if (!next || next === m.name) {
                                  e.target.value = m.name
                                  return
                                }
                                patchMember(inv.fileName, m.rowIndex, { name: next })
                                const official = formatRosterName(next)
                                if (official && !roster.includes(official)) {
                                  applyRoster([...roster, official])
                                }
                              }}
                            />
                          ) : (
                            <div>{m.name}</div>
                          )}
                          {m.ocrName && m.ocrName !== m.name ? (
                            <div className="ocr-name-note">Invoice read: {m.ocrName}</div>
                          ) : null}
                          {m.flags.length > 0 ? (
                            <div className="row-flag-note">{m.flags[0]}</div>
                          ) : null}
                        </td>
                        <td className="num">
                          <input
                            className={`field-input${m.familyCount == null ? ' field-missing' : ''}`}
                            inputMode="numeric"
                            defaultValue={m.familyCount ?? ''}
                            key={`fam:${m.familyCount ?? ''}`}
                            aria-label={`Family count for ${m.name}`}
                            placeholder="—"
                            onBlur={(e) => {
                              const raw = e.target.value.trim()
                              const next = raw === '' ? null : Number(raw)
                              const value =
                                next != null && Number.isFinite(next) && next >= 0 && next <= 20
                                  ? next
                                  : null
                              if (value === m.familyCount) {
                                e.target.value = m.familyCount == null ? '' : String(m.familyCount)
                                return
                              }
                              patchMember(inv.fileName, m.rowIndex, { familyCount: value })
                            }}
                          />
                        </td>
                        <td>
                          <select
                            className={`field-input${m.coverage ? '' : ' field-missing'}`}
                            value={m.coverage}
                            aria-label={`Coverage for ${m.name}`}
                            title={coverageLabel(m.coverage)}
                            onChange={(e) =>
                              patchMember(inv.fileName, m.rowIndex, {
                                coverage: e.target.value,
                              })
                            }
                          >
                            <option value="">—</option>
                            {COVERAGE_CODES.map((code) => (
                              <option key={code} value={code}>
                                {code} · {coverageLabel(code)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className={`field-input${m.status ? '' : ' field-missing'}`}
                            value={m.status}
                            aria-label={`Status for ${m.name}`}
                            title={statusLabel(m.status)}
                            onChange={(e) =>
                              patchMember(inv.fileName, m.rowIndex, {
                                status: e.target.value,
                              })
                            }
                          >
                            <option value="">—</option>
                            {STATUS_CODES.map((code) => (
                              <option key={code} value={code}>
                                {code} · {statusLabel(code)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            className={`field-input${m.medicalPlan ? '' : ' field-missing'}`}
                            value={m.medicalPlan}
                            aria-label={`Medical plan for ${m.name}`}
                            onChange={(e) =>
                              patchMember(inv.fileName, m.rowIndex, {
                                medicalPlan: e.target.value,
                              })
                            }
                          >
                            <option value="">—</option>
                            {plans.map((plan) => (
                              <option key={plan} value={plan}>
                                {plan}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num">
                          <input
                            className={`field-input field-input-amount${m.medicalCurrentCharge == null ? ' field-missing' : ''}`}
                            inputMode="decimal"
                            defaultValue={
                              m.medicalCurrentCharge == null ? '' : String(m.medicalCurrentCharge)
                            }
                            key={`amt:${m.medicalCurrentCharge ?? ''}`}
                            aria-label={`Current charge for ${m.name}`}
                            placeholder="—"
                            onBlur={(e) => {
                              const raw = e.target.value.trim()
                              const next = raw === '' ? null : parseMoney(raw)
                              if (next === m.medicalCurrentCharge) {
                                e.target.value =
                                  m.medicalCurrentCharge == null ? '' : String(m.medicalCurrentCharge)
                                return
                              }
                              patchMember(inv.fileName, m.rowIndex, {
                                medicalCurrentCharge: next,
                              })
                            }}
                          />
                        </td>
                        <td>{inv.meta.billPeriod || '—'}</td>
                        <td className="notes-cell">{inv.fileName}</td>
                      </tr>
                    )
                  })}
                  {invoices
                    .filter((inv) => inv.members.length === 0)
                    .map((inv) => (
                      <tr key={`empty-${inv.fileName}`} className="row-flagged">
                        <td colSpan={8}>
                          <strong>{inv.fileName}</strong>
                          {' — '}
                          {inv.errors[0] || 'No membership rows found.'}
                          {inv.warnings.length > 0 && (
                            <div className="detail-file">{inv.warnings.slice(0, 3).join(' ')}</div>
                          )}
                        </td>
                      </tr>
                    ))}
                  <tr className="add-missing-row">
                    <td colSpan={8}>
                      <form
                        className="add-missing-form"
                        onSubmit={(e) => {
                          e.preventDefault()
                          addBlankRow()
                        }}
                      >
                        <input
                          className="field-input"
                          value={blankRowName}
                          onChange={(e) => {
                            setBlankRowName(e.target.value)
                            if (blankRowError) setBlankRowError('')
                          }}
                          placeholder="LAST, FIRST"
                          aria-label="Name for missing row"
                        />
                        <button type="submit" className="btn secondary">
                          Add missing row
                        </button>
                        {blankRowError ? <span className="roster-error">{blankRowError}</span> : null}
                      </form>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

export default App

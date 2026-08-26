/** Employee list used until someone is hired or leaves. Edit names in the app. */
export const DEFAULT_MEMBER_ROSTER = [
  'ALZAMORA, ARACELLY M',
  'BUCKLEY, CALEB J',
  'CONE, ARI M',
  'COWHAM, ANGELA',
  'DIBBLE, SEAN',
  'DREYER, JOHN',
  'ELAZIER, DESTINY C',
  'FIELDS, NICOLE',
  'GRAY, MARIANNE K',
  'GRIGGS, JANE H',
  'HOBBS, BAILEE',
  'HOSLER, JACOB H',
  'HOUGHTON, DAPHNE E',
  'KELLY, NANCY I',
  'KNAUSENBERGER, CLARA',
  'MAYNARD, CHRISTINA W',
  'MILLER, WENDY W',
  'MULROONEY, JULIE L',
  'OSPINA, SIDONIE',
  'PAYNE, STEPHEN D',
  'POWELL, ROBIN',
  'RABBETTS, SUNNEE DAE',
  'RAINSFORD, MELISSA N',
  'RODRIGUEZ, ELOISA M',
  'ROOS, KAREN',
  'SANCHEZ, CECILIA',
  'SARRADET, INA M',
  'SCHILLER, MINDY',
  'SIMMS, KHALEHLA',
  'SULLIVAN, ANDREW P',
  'WINFIELD, JONATHAN F',
  'ZAIKINE-SINCLAIR, ANASTASIA',
]

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if ((ch === ',' || ch === '\t') && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

function looksLikePersonName(value: string): boolean {
  const v = value.replace(/\s+/g, ' ').trim()
  if (v.length < 5 || v.length > 80) return false
  if (/^(file name|bill period|statement id|name|family count)$/i.test(v)) return false
  if (!/[A-Za-z]{3,}/.test(v)) return false
  return /[A-Za-z].*,\s*[A-Za-z]/.test(v) || v.split(/\s+/).length >= 2
}

export function formatRosterName(raw: string): string | null {
  const v = raw.replace(/\s+/g, ' ').trim().toUpperCase()
  if (v.length < 5) return null
  const comma = v.indexOf(',')
  if (comma < 2) return null
  const last = v.slice(0, comma).trim()
  const first = v.slice(comma + 1).trim()
  if (last.length < 2 || first.length < 2) return null
  return `${last}, ${first}`
}

function normalizeRosterName(value: string): string {
  return formatRosterName(value) ?? value.replace(/\s+/g, ' ').trim().toUpperCase()
}

/** Read LAST, FIRST names from a CSV (Name column) or a plain list. */
export function parseMemberRoster(text: string): string[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.length === 0) return []

  const headerCols = splitCsvLine(lines[0])
  const nameIdx = headerCols.findIndex((c) => c.replace(/['"]/g, '').trim().toLowerCase() === 'name')
  const body = nameIdx >= 0 ? lines.slice(1) : lines

  const names: string[] = []
  for (const line of body) {
    if (nameIdx < 0 && looksLikePersonName(line)) {
      names.push(normalizeRosterName(line))
      continue
    }
    const cols = splitCsvLine(line)
    const fromCol = nameIdx >= 0 ? (cols[nameIdx] ?? '') : ''
    const guessed = cols.find((c) => looksLikePersonName(c)) ?? ''
    const raw = fromCol || guessed
    if (!looksLikePersonName(raw)) continue
    names.push(normalizeRosterName(raw))
  }

  const seen = new Set<string>()
  return names.filter((n) => {
    if (seen.has(n)) return false
    seen.add(n)
    return true
  })
}

export function mergeRosterNames(existing: string[], toAdd: string[]): string[] {
  const seen = new Set(existing)
  const extra = toAdd.filter((n) => n && !seen.has(n))
  if (extra.length === 0) return existing
  return [...existing, ...extra].sort((a, b) => a.localeCompare(b))
}

export function isRosterFileName(name: string): boolean {
  const n = name.toLowerCase()
  return n.endsWith('.csv') || n.endsWith('.txt') || n.endsWith('.tsv')
}

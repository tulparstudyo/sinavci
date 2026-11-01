import { useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, FileSpreadsheet, Search, Upload, Users, X } from 'lucide-react'
import type { Gender, Student } from '../types'

type FieldKey = 'className' | 'schoolNumber' | 'fullName' | 'gender'
type Mapping = Record<FieldKey, number> & { surname: number }

interface ExcelImportProps {
  onImport: (students: Student[], institutionName?: string) => Promise<void>
  onImported?: (students: Student[]) => void
}

interface SheetData {
  name: string
  rows: unknown[][]
  headerRow: number
  headers: string[]
  mapping: Mapping
  className: string
  classByRow: string[]
  serialColumn: number
  institutionName: string
}

const fieldLabels: Record<FieldKey, string> = {
  className: 'Sınıf / şube',
  schoolNumber: 'Okul numarası',
  fullName: 'Adı soyadı',
  gender: 'Cinsiyet',
}

const aliases: Record<FieldKey, string[]> = {
  className: ['sinif sube', 'sinif', 'sube', 'sinif subesi', 'sinif sube adi', 'sinif adi'],
  schoolNumber: ['okul no', 'okul numarasi', 'ogrenci no', 'ogrenci numarasi', 'numara'],
  fullName: ['adi soyadi', 'ad soyad', 'ogrenci adi soyadi', 'adi ve soyadi'],
  gender: ['cinsiyet', 'cins'],
}

const surnameAliases = ['soyadi', 'soyad', 'surname', 'last name']

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function detectMapping(headers: string[]): Mapping {
  const normalizedHeaders = headers.map(normalizeText)
  const findColumn = (field: FieldKey) => {
    const candidates = aliases[field]
    const exactMatch = normalizedHeaders.findIndex((header) => candidates.includes(header))
    if (exactMatch >= 0) return exactMatch
    return normalizedHeaders.findIndex((header) => candidates.some((alias) => alias.length >= 5 && header.includes(alias)))
  }
  const firstName = normalizedHeaders.findIndex((header) => ['adi', 'ad', 'first name'].includes(header))
  const exactSurname = normalizedHeaders.findIndex((header) => surnameAliases.includes(header))
  const surname = exactSurname >= 0
    ? exactSurname
    : normalizedHeaders.findIndex((header) =>
        !aliases.fullName.some((alias) => header.includes(alias)) &&
        surnameAliases.some((alias) => header.includes(alias)),
      )

  return {
    className: findColumn('className'),
    schoolNumber: findColumn('schoolNumber'),
    fullName: findColumn('fullName') >= 0 ? findColumn('fullName') : firstName,
    gender: findColumn('gender'),
    surname,
  }
}

function extractClassName(value: unknown): string {
  const text = String(value ?? '')
  const classAndSection = text.match(/\b(9|10|11|12)\s*\.?\s*sınıf\s*\/\s*([a-z])\s*şubesi\b/i)
  if (classAndSection) return `${classAndSection[1]}-${classAndSection[2].toLocaleUpperCase('tr-TR')}`
  const compactClass = text.match(/\b(9|10|11|12)\s*[-/]\s*([a-z])\b/i)
  return compactClass ? `${compactClass[1]}-${compactClass[2].toLocaleUpperCase('tr-TR')}` : ''
}

function detectClassNamesByRow(rows: unknown[][]): string[] {
  let currentClassName = ''
  return rows.map((row) => {
    const classHeading = row.map(extractClassName).find(Boolean)
    if (classHeading) currentClassName = classHeading
    return currentClassName
  })
}

function detectInstitutionName(rows: unknown[][]): string {
  const topRows = rows.slice(0, 12).flatMap((row) =>
    row.flatMap((cell) => String(cell ?? '').split(/\r?\n/))
      .map((value) => value.replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  )
  const isSchoolName = (value: string) =>
    /(?:anadolu\s+imam\s+hatip\s+lisesi|lisesi|okulu|koleji|üniversitesi|universitesi|eğitim merkezi|egitim merkezi)/i.test(value)
  const isHeader = (value: string) => /(?:sınıf listesi|sinif listesi|öğrenci no|ogrenci no|adı soyadı|adi soyadi)/i.test(value)
  const labeled = topRows.find((value) => /^(?:okul|kurum)\s*(?:adı|adi)\s*[:\-]/i.test(value))
  const detected = labeled
    ? labeled.replace(/^(?:okul|kurum)\s*(?:adı|adi)\s*[:\-]\s*/i, '').trim()
    : topRows.find((value) => isSchoolName(value) && !isHeader(value))
  return detected?.slice(0, 120) ?? ''
}

function findHeaderRow(rows: unknown[][]): number {
  const searchRows = rows.slice(0, 15)
  let bestIndex = 0
  let bestScore = -1

  searchRows.forEach((row, index) => {
    const mapping = detectMapping(row.map((cell) => String(cell ?? '')))
    const score = Object.values(mapping).filter((column) => column >= 0).length
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  })

  return bestIndex
}

function parseGender(value: unknown): Gender | null {
  const normalized = normalizeText(value)
  if (['k', 'kiz', 'kadın', 'kadin', 'female', 'f'].includes(normalized)) return 'K'
  if (['e', 'erkek', 'male', 'm'].includes(normalized)) return 'E'
  if (['b', 'belirtilmemis', 'belirtilmemiş', 'diger', 'diğer'].includes(normalized)) return 'B'
  return null
}

function findGenderDataColumn(rows: unknown[][], headerRow: number, headerColumn: number): number {
  const sample = rows.slice(headerRow + 1, headerRow + 101)
  const countGenderValues = (column: number) => sample.filter((row) => parseGender(row[column])).length
  const headerColumnCount = countGenderValues(headerColumn)
  if (headerColumnCount > 0) return headerColumn

  let bestColumn = headerColumn
  let bestCount = 0
  const columnCount = Math.max(...sample.map((row) => row.length), 0)
  for (let column = 0; column < columnCount; column += 1) {
    const count = countGenderValues(column)
    if (count > bestCount) {
      bestColumn = column
      bestCount = count
    }
  }
  return bestCount >= 3 ? bestColumn : headerColumn
}

function normalizeClassName(value: unknown): string {
  return String(value ?? '').trim().toLocaleUpperCase('tr-TR').replace(/\s+/g, '')
}

function createStudents(sheet: SheetData): { students: Student[]; issues: string[] } {
  const students: Student[] = []
  const issues: string[] = []
  const seen = new Set<string>()
  const dataRows = sheet.rows.slice(sheet.headerRow + 1)

  dataRows.forEach((row, index) => {
    const lineNumber = sheet.headerRow + index + 2
    const value = (field: FieldKey) => row[sheet.mapping[field]]
    if (sheet.serialColumn >= 0 && !/^\d+$/.test(String(row[sheet.serialColumn] ?? '').trim())) return
    const rowClassName = sheet.mapping.className >= 0 ? value('className') : ''
    const rowClassIndex = sheet.headerRow + index + 1
    const schoolNumber = String(value('schoolNumber') ?? '').trim()
    const normalizedSchoolNumber = normalizeText(schoolNumber)
    const nameParts = [value('fullName'), sheet.mapping.surname >= 0 ? row[sheet.mapping.surname] : '']
    const fullName = nameParts.map((part) => String(part ?? '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ')
    const genderValue = value('gender')
    const gender = parseGender(genderValue) ?? (!String(genderValue ?? '').trim() ? 'B' : null)

    if (!rowClassName && !schoolNumber && !fullName) return
    if (
      ['ogrenci no', 's no', 's no.', 'toplam ogrenci sayisi'].includes(normalizedSchoolNumber) ||
      normalizeText(fullName) === 'adi soyadi'
    ) return
    const className = normalizeClassName(rowClassName || sheet.classByRow[rowClassIndex] || sheet.className)
    if (!className || !schoolNumber || !fullName || !gender) {
      issues.push(`${lineNumber}. satır: sınıf, okul numarası, ad soyad veya cinsiyet eksik/geçersiz.`)
      return
    }

    const key = `${className}:${schoolNumber}`
    if (seen.has(key)) {
      issues.push(`${lineNumber}. satır: ${className} sınıfında ${schoolNumber} numarası birden fazla kullanılıyor.`)
      return
    }

    seen.add(key)
    students.push({ className, schoolNumber, fullName, gender, createdAt: new Date().toISOString() })
  })

  return { students, issues }
}

export default function ExcelImport({ onImport, onImported }: ExcelImportProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [workbook, setWorkbook] = useState<SheetData[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [issuesExpanded, setIssuesExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)

  const sheet = workbook[activeSheet]
  const parsed = useMemo(() => (sheet ? createStudents(sheet) : { students: [], issues: [] }), [sheet])
  const allParsed = useMemo(
    () => workbook.reduce(
      (result, item) => {
        const sheetResult = createStudents(item)
        result.students.push(...sheetResult.students)
        result.issues.push(...sheetResult.issues.map((issue) => `${item.name}: ${issue}`))
        return result
      },
      { students: [] as Student[], issues: [] as string[] },
    ),
    [workbook],
  )
  const filteredStudents = useMemo(() => {
    const normalizedQuery = normalizeText(query)
    if (!normalizedQuery) return parsed.students
    return parsed.students.filter((student) =>
      normalizeText(`${student.fullName} ${student.schoolNumber} ${student.className}`).includes(normalizedQuery),
    )
  }, [parsed.students, query])
  const classCount = new Set(allParsed.students.map((student) => student.className)).size

  async function loadFile(file?: File) {
    if (!file) return
    setError('')
    setSaved(false)
    try {
      const XLSX = await import('xlsx')
      const data = await file.arrayBuffer()
      const parsedWorkbook = XLSX.read(data, { type: 'array' })
      const sheets = parsedWorkbook.SheetNames.map((name) => {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(parsedWorkbook.Sheets[name], {
          header: 1,
          defval: '',
          raw: false,
        })
        const headerRow = findHeaderRow(rows)
        const headers = (rows[headerRow] ?? []).map((cell) => String(cell ?? '').trim())
        const mapping = detectMapping(headers)
        mapping.gender = findGenderDataColumn(rows, headerRow, mapping.gender)
        const classByRow = detectClassNamesByRow(rows)
        const className = classByRow.find(Boolean) ?? ''
        const serialColumn = headers.findIndex((header) =>
          ['s no', 'sira no', 'sira numarasi'].includes(normalizeText(header)),
        )
        return {
          name,
          rows,
          headerRow,
          headers,
          mapping,
          className,
          classByRow,
          serialColumn,
          institutionName: detectInstitutionName(rows),
        }
      })
      if (sheets.length === 0 || sheets.every((item) => item.rows.length === 0)) {
        throw new Error('Dosyada okunabilir bir çalışma sayfası bulunamadı.')
      }
      setWorkbook(sheets)
      setActiveSheet(0)
      setQuery('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Excel dosyası okunamadı.')
      setWorkbook([])
    }
  }

  function updateMapping(field: FieldKey, column: number) {
    setWorkbook((current) =>
      current.map((item, index) =>
        index === activeSheet ? { ...item, mapping: { ...item.mapping, [field]: column } } : item,
      ),
    )
  }

  function updateClassName(className: string) {
    setWorkbook((current) =>
      current.map((item, index) => (index === activeSheet ? { ...item, className } : item)),
    )
  }

  async function importStudents() {
    if (!allParsed.students.length) return
    setIsSaving(true)
    setError('')
    try {
      const institutionName = workbook.find((item) => item.institutionName)?.institutionName
      await onImport(allParsed.students, institutionName)
      onImported?.(allParsed.students)
      setSaved(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Öğrenciler kaydedilemedi.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="import-card">
      {!sheet ? (
        <button
          className={`upload-zone ${dragging ? 'upload-zone-active' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            void loadFile(event.dataTransfer.files[0])
          }}
          type="button"
        >
          <span className="upload-icon"><Upload size={23} /></span>
          <span className="upload-title">Excel dosyanızı buraya bırakın</span>
          <span className="upload-subtitle">veya bilgisayarınızdan dosya seçin</span>
          <span className="file-types">.XLSX, .XLS dosyaları desteklenir</span>
        </button>
      ) : (
        <>
          <div className="file-bar">
            <div className="file-meta">
              <span className="file-icon"><FileSpreadsheet size={20} /></span>
              <div><strong>{sheet.name}</strong><span>{sheet.rows.length} satır · {sheet.headers.length} sütun</span></div>
            </div>
            <button className="text-button" type="button" onClick={() => { setWorkbook([]); setSaved(false) }}>
              <X size={15} /> Dosyayı değiştir
            </button>
          </div>
          {workbook.length > 1 && (
            <label className="sheet-picker">Çalışma sayfası
              <span className="select-wrap">
                <select value={activeSheet} onChange={(event) => setActiveSheet(Number(event.target.value))}>
                  {workbook.map((item, index) => <option value={index} key={item.name}>{item.name}</option>)}
                </select>
                <ChevronDown size={15} />
              </span>
            </label>
          )}
          <div className="mapping-section">
            <div className="section-heading">
              <div><h3>Sütun eşleştirme</h3><p>Başlıklar otomatik tanındı; gerekirse kontrol edin.</p></div>
              {sheet.mapping.schoolNumber >= 0 && sheet.mapping.fullName >= 0 && sheet.mapping.gender >= 0 &&
                (sheet.mapping.className >= 0 || sheet.className) && (
                <span className="detected"><Check size={13} /> Tüm alanlar eşleşti</span>
              )}
            </div>
            <div className="mapping-grid">
              {(Object.keys(fieldLabels) as FieldKey[]).map((field) => (
                <label className="mapping-field" key={field}>
                  <span>{fieldLabels[field]} <i>*</i></span>
                  <span className="select-wrap">
                    <select value={sheet.mapping[field]} onChange={(event) => updateMapping(field, Number(event.target.value))}>
                      <option value={-1}>Sütun seçin</option>
                      {sheet.headers.map((header, index) => (
                        <option key={`${index}-${header}`} value={index}>{header || `Sütun ${index + 1}`}</option>
                      ))}
                    </select>
                    <ChevronDown size={15} />
                  </span>
                  {field === 'className' && (
                    <input
                      className="class-fallback"
                      value={sheet.className}
                      onChange={(event) => updateClassName(event.target.value)}
                      placeholder="Örn. 9-A (başlıktan otomatik alınır)"
                      aria-label="Varsayılan sınıf ve şube"
                    />
                  )}
                  {field === 'fullName' && sheet.mapping.surname >= 0 && (
                    <span className="name-hint">Ad ve soyadı ayrı sütunlardan birleştirilir.</span>
                  )}
                </label>
              ))}
            </div>
          </div>
          <div className="stats-row">
            <div><Users size={17} /><strong>{allParsed.students.length}</strong><span>öğrenci</span></div>
            <div><span className="stat-dot" /><strong>{classCount}</strong><span>şube</span></div>
            {allParsed.issues.length > 0 && (
              <button className="issue-count" type="button" onClick={() => setIssuesExpanded((expanded) => !expanded)}>
                <AlertCircle size={16} /> {allParsed.issues.length} satır kontrol edilmeli
              </button>
            )}
          </div>
          {issuesExpanded && (
            <div className="issues-list">
              {allParsed.issues.slice(0, 8).map((issue) => <p key={issue}>{issue}</p>)}
              {allParsed.issues.length > 8 && <p>ve {allParsed.issues.length - 8} satır daha…</p>}
            </div>
          )}
          <div className="table-toolbar">
            <div><h3>Öğrenci önizlemesi</h3><span>{filteredStudents.length} kayıt gösteriliyor</span></div>
            <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Öğrenci ara..." /></label>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>OKUL NO</th><th>ADI SOYADI</th><th>SINIF / ŞUBE</th><th>CİNSİYET</th></tr></thead>
              <tbody>
                {filteredStudents.slice(0, 8).map((student) => (
                  <tr key={`${student.className}-${student.schoolNumber}`}>
                    <td className="number-cell">{student.schoolNumber}</td><td className="name-cell">{student.fullName}</td>
                    <td><span className="class-tag">{student.className}</span></td>
                    <td><span className={`gender-tag gender-${student.gender}`}>{student.gender === 'K' ? 'Kız' : student.gender === 'E' ? 'Erkek' : 'Belirtilmemiş'}</span></td>
                  </tr>
                ))}
                {filteredStudents.length === 0 && <tr><td colSpan={4} className="empty-table">Eşleşen kayıt bulunamadı.</td></tr>}
              </tbody>
            </table>
            {filteredStudents.length > 8 && <div className="table-footer">İlk 8 kayıt gösteriliyor · Toplam {filteredStudents.length} öğrenci</div>}
          </div>
          <div className="import-footer">
            <span className="privacy-note"><span /> Verileriniz yalnızca bu cihazda saklanır.</span>
            <button className="primary-button" type="button" onClick={() => void importStudents()} disabled={!allParsed.students.length || isSaving}>
              {isSaving ? 'Kaydediliyor...' : saved ? <><Check size={16} /> Öğrenciler kaydedildi</> : <><Users size={16} /> {allParsed.students.length} öğrenciyi içe aktar</>}
            </button>
          </div>
        </>
      )}
      {error && <div className="error-message"><AlertCircle size={16} />{error}</div>}
      <input ref={inputRef} className="visually-hidden" type="file" accept=".xlsx,.xls" onChange={(event) => void loadFile(event.target.files?.[0])} />
    </section>
  )
}

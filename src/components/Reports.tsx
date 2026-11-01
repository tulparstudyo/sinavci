import { Fragment, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer } from 'lucide-react'
import { compareClassNames } from '../classSort'
import type { Exam, Room, SeatAssignment, Student } from '../types'

interface ReportsProps {
  exams: Exam[]
  assignments: SeatAssignment[]
  students: Student[]
  rooms: Room[]
  institutionName: string
}

interface StudentReportRow {
  exam: Exam
  assignment: SeatAssignment
  student: Student
  room: Room
}

interface RoomReport {
  key: string
  room: Room
  examDate: string
  session: string
  exams: Exam[]
  rows: StudentReportRow[]
  displayRowsByColumn: number[]
  deskCount: number
}

function compareStudents(a: StudentReportRow, b: StudentReportRow): number {
  return a.student.schoolNumber.localeCompare(b.student.schoolNumber, 'tr', { numeric: true }) ||
    a.student.fullName.localeCompare(b.student.fullName, 'tr')
}

function seatPosition(assignment: SeatAssignment): string {
  const side = assignment.side === 'left' ? 'Sol' : 'Sağ'
  return `Grup-${assignment.column} · Sıra ${assignment.row} · ${side}`
}

function studentGrade(student: Student): number {
  return Number(student.className.match(/^\d{1,2}/)?.[0]) || 0
}

export default function Reports({ exams, assignments, students, rooms, institutionName }: ReportsProps) {
  const [printTarget, setPrintTarget] = useState<string | null>(null)
  const studentById = new Map<number, Student>(students.flatMap((student) =>
    student.id === undefined ? [] : [[student.id, student] as const],
  ))
  const roomById = new Map<number, Room>(rooms.flatMap((room) =>
    room.id === undefined ? [] : [[room.id, room] as const],
  ))
  const examReports = exams.flatMap((exam) => {
    if (exam.id === undefined) return []
    const examAssignments = assignments.filter((assignment) => assignment.examId === exam.id)
    const validRows = examAssignments.flatMap((assignment) => {
      const student = studentById.get(assignment.studentId)
      const room = roomById.get(assignment.roomId)
      if (!student || !room || !exam.classNames.includes(student.className)) return []
      return [{ exam, assignment, student, room }]
    })
    return validRows.length > 0 ? [{ exam, rows: validRows }] : []
  })
  const roomReportMap = new Map<string, RoomReport>()
  examReports.forEach(({ exam, rows }) => rows.forEach((row) => {
    const roomId = row.assignment.roomId
    const key = `room-${exam.examDate ?? ''}-${exam.session}-${roomId}`
    const report = roomReportMap.get(key) ?? {
      key,
      room: row.room,
      examDate: exam.examDate ?? 'Tarih belirtilmedi',
      session: exam.session,
      exams: [],
      rows: [],
      displayRowsByColumn: [],
      deskCount: 0,
    }
    if (!report.exams.some((item) => item.id === exam.id)) report.exams.push(exam)
    report.rows.push(row)
    roomReportMap.set(key, report)
  }))
  const roomReports = [...roomReportMap.values()].map((report) => {
    const sortedRows = [...report.rows].sort((a, b) =>
      compareClassNames(a.student.className, b.student.className) ||
      compareStudents(a, b),
    )
    const remainingRows = [...sortedRows]
    const pairRows: StudentReportRow[][] = []
    while (remainingRows.length > 0) {
      const first = remainingRows.shift()
      if (!first) continue
      const differentGradeIndex = remainingRows.findIndex((candidate) =>
        candidate.student.className !== first.student.className &&
        studentGrade(candidate.student) !== studentGrade(first.student),
      )
      const differentClassIndex = remainingRows.findIndex((candidate) =>
        candidate.student.className !== first.student.className,
      )
      const partnerIndex = differentGradeIndex >= 0 ? differentGradeIndex : differentClassIndex
      const pair = [first]
      if (partnerIndex >= 0) pair.push(remainingRows.splice(partnerIndex, 1)[0])
      pairRows.push(pair)
    }

    const columnCount = Math.max(1, report.room.columns)
    const baseRowsPerColumn = Math.floor(pairRows.length / columnCount)
    const extraRows = pairRows.length % columnCount
    const displayRowsByColumn = Array.from({ length: columnCount }, (_, index) =>
      baseRowsPerColumn + (index < extraRows ? 1 : 0),
    )
    const remainingPairs = [...pairRows]
    const compactRows: StudentReportRow[] = []
    displayRowsByColumn.forEach((rowCount, columnIndex) => {
      let previousPair: StudentReportRow[] | undefined
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        let bestPairIndex = 0
        let bestSequenceConflicts = Number.POSITIVE_INFINITY
        remainingPairs.forEach((pair, candidateIndex) => {
          const sequenceConflicts = previousPair?.reduce((count, previous, sideIndex) =>
            count + Number(pair[sideIndex]?.student.className === previous.student.className), 0) ?? 0
          if (sequenceConflicts < bestSequenceConflicts) {
            bestSequenceConflicts = sequenceConflicts
            bestPairIndex = candidateIndex
          }
        })
        const pair = remainingPairs.splice(bestPairIndex, 1)[0]
        if (!pair) continue
        pair?.forEach((item, sideIndex) => {
          compactRows.push({
            ...item,
            assignment: {
              ...item.assignment,
              column: columnIndex + 1,
              row: rowIndex + 1,
              side: sideIndex === 0 ? 'left' : 'right',
            },
          })
        })
        previousPair = pair
      }
    })
    return {
      ...report,
      displayRowsByColumn,
      deskCount: pairRows.length,
      rows: compactRows,
    }
  })
  const compactPositionByAssignment = new Map<string, SeatAssignment>()
  roomReports.forEach((report) => report.rows.forEach(({ exam, assignment }) => {
    compactPositionByAssignment.set(`${exam.id}:${assignment.studentId}`, assignment)
  }))
  const classReports = examReports.flatMap(({ exam, rows }) =>
    [...exam.classNames].sort(compareClassNames).flatMap((className) => {
      const classRows = rows
        .filter((row) => row.student.className === className)
        .map((row) => ({
          ...row,
          assignment: compactPositionByAssignment.get(`${exam.id}:${row.assignment.studentId}`) ?? row.assignment,
        }))
        .sort(compareStudents)
      return classRows.length > 0
        ? [{ key: `class-${exam.id}-${className}`, exam, className, rows: classRows }]
        : []
    }),
  )
  const allReports = [...classReports, ...roomReports]

  useEffect(() => {
    if (printTarget === null) return
    window.print()
    setPrintTarget(null)
  }, [printTarget])

  function printReport(key: string) {
    setPrintTarget(key)
  }

  function printAll() {
    setPrintTarget('all')
  }

  function isSelected(key: string): boolean {
    return printTarget === 'all' || printTarget === key
  }

  function isLastSelected(key: string): boolean {
    return printTarget === key || (printTarget === 'all' && allReports[allReports.length - 1]?.key === key)
  }

  return (
    <div className="reports">
      <div className="report-actions">
        <div>
          <h3>Yazdırılabilir raporlar</h3>
          <p>{allReports.length} rapor hazır · Her rapor A4 sayfa düzeninde yazdırılır.</p>
        </div>
        <button className="primary-button" type="button" onClick={printAll} disabled={allReports.length === 0}>
          <Printer size={15} /> Tüm raporları yazdır
        </button>
      </div>

      <div className="report-help">
        Her şube için salon ve koltuk bilgili giriş listesi; her sınav salonu için oturma planı, ders özeti ve gözetmen imza alanı oluşturulur.
      </div>

      {allReports.length === 0 ? (
        <div className="report-plan-status">Yazdırılabilir rapor oluşturmak için 03. adımda en az bir sınavın dağıtımını tamamlayın.</div>
      ) : (
        <>
          <section className="report-list-section">
            <h4>Şube bazlı sınav giriş listeleri <span>{classReports.length}</span></h4>
            {classReports.length === 0 ? <p className="report-empty">Henüz şube giriş listesi yok.</p> : classReports.map((report) => (
              <div className="report-list-row" key={report.key}>
                <span><strong>{report.className}</strong><small>{report.exam.subject} · {report.rows.length} öğrenci</small></span>
                <button className="report-print-button" type="button" onClick={() => printReport(report.key)} aria-label={`${report.className} ${report.exam.subject} giriş listesini yazdır`}>
                  <Printer size={14} /> Yazdır
                </button>
              </div>
            ))}
          </section>

          <section className="report-list-section">
            <h4>Sınav salonu oturma planları <span>{roomReports.length}</span></h4>
            {roomReports.length === 0 ? <p className="report-empty">Henüz salon oturma planı yok.</p> : roomReports.map((report) => (
              <div className="report-list-row" key={report.key}>
                <span><strong>{report.room.name}</strong><small>{report.exams.map((exam) => exam.subject).join(', ')} · {report.rows.length} öğrenci · {report.deskCount} masa / {report.deskCount * 2} koltuk · {report.examDate} · {report.session}</small></span>
                <button className="report-print-button" type="button" onClick={() => printReport(report.key)} aria-label={`${report.room.name} ortak oturma planını yazdır`}>
                  <Printer size={14} /> Yazdır
                </button>
              </div>
            ))}
          </section>
        </>
      )}

      {createPortal(<div className="print-report-container" aria-hidden="true">
        {classReports.map((report) => (
          <article className={`print-report-page ${isSelected(report.key) ? 'print-selected' : ''} ${isLastSelected(report.key) ? 'print-last' : ''}`} key={report.key}>
            <header className="print-report-header">
              <div><h1>{report.className} Sınıfı Sınav Giriş Listesi</h1><p>{institutionName && <>{institutionName} · </>}{report.exam.subject} · {report.exam.examDate ?? 'Tarih belirtilmedi'} · {report.exam.session}</p></div>
              <span>{report.rows.length} öğrenci</span>
            </header>
            <table className="print-table">
              <thead><tr><th>Okul No</th><th>Adı Soyadı</th><th>Sınav Salonu</th><th>Sıra / Pozisyon</th></tr></thead>
              <tbody>{report.rows.map(({ assignment, student, room }) => (
                <tr key={student.id}>
                  <td>{student.schoolNumber}</td><td>{student.fullName}</td><td>{room.name}</td><td>{seatPosition(assignment)}</td>
                </tr>
              ))}</tbody>
            </table>
          </article>
        ))}

        {roomReports.map((report) => {
          const studentsBySeat = new Map(report.rows.map((row) => [
            `${row.assignment.column}:${row.assignment.row}:${row.assignment.side}`,
            row,
          ]))
          const examSummary = new Map<string, number>()
          report.rows.forEach(({ exam }) => {
            examSummary.set(exam.subject, (examSummary.get(exam.subject) ?? 0) + 1)
          })
          return (
            <Fragment key={report.key}>
              <article className={`print-report-page room-print-page ${isSelected(report.key) ? 'print-selected' : ''} ${isLastSelected(report.key) ? 'print-last' : ''}`}>
                <header className="print-report-header">
                  <div><h1>{report.room.name} Sınav Salonu</h1><p>{institutionName && <>{institutionName} · </>}{report.exams.map((exam) => exam.subject).join(', ')} · {report.examDate} · {report.session}</p></div>
                  <span>{report.rows.length} öğrenci</span>
                </header>
                <div className="room-print-meta">
                  <div><strong>Sınav özeti</strong>
                    {[...examSummary.entries()].sort(([a], [b]) => a.localeCompare(b, 'tr')).map(([subject, count]) => (
                      <span key={subject}>{subject}: {count} öğrenci</span>
                    ))}
                  </div>
                  <div className="proctor-signature"><strong>Gözetmen Öğretmen</strong><span>Ad Soyad / İmza</span></div>
                </div>
                <div className="room-seating-grid" style={{ gridTemplateColumns: `repeat(${report.room.columns}, minmax(0, 1fr))` }}>
                  {Array.from({ length: report.room.columns }, (_, columnIndex) => (
                    <section className="room-seat-column" key={columnIndex}>
                      <h2>Grup-{columnIndex + 1}</h2>
                      {Array.from({ length: report.displayRowsByColumn[columnIndex] ?? 0 }, (_, rowIndex) => (
                        <div className="room-seat-pair" key={rowIndex}>
                          {(['left', 'right'] as const).map((side) => {
                            const row = studentsBySeat.get(`${columnIndex + 1}:${rowIndex + 1}:${side}`)
                            return (
                              <div className="room-seat" key={side}>
                                <small>{rowIndex + 1} · {side === 'left' ? 'Sol' : 'Sağ'}</small>
                                {row ? (
                                  <><strong>{row.student.fullName}</strong><span>{row.student.schoolNumber} · {row.student.className}</span><em>{row.exam.subject}</em></>
                                ) : <strong className="empty-seat">BOŞ</strong>}
                              </div>
                            )
                          })}
                        </div>
                      ))}
                    </section>
                  ))}
                </div>
              </article>
              <article className={`print-report-page room-signature-page ${isSelected(report.key) ? 'print-selected' : ''} ${isLastSelected(report.key) ? 'print-last' : ''}`}>
                <header className="print-report-header">
                  <div><h1>{report.room.name} Öğrenci İmza Çizelgesi</h1><p>{institutionName && <>{institutionName} · </>}{report.exams.map((exam) => exam.subject).join(', ')} · {report.examDate} · {report.session}</p></div>
                  <span>{report.rows.length} öğrenci</span>
                </header>
                <table className="print-table room-signature-table">
                  <thead><tr><th>Sıra / Konum</th><th>Okul No</th><th>Adı Soyadı</th><th>Şube</th><th>Ders</th><th>İmza</th></tr></thead>
                  <tbody>{report.rows.map(({ assignment, student, exam }) => (
                    <tr key={student.id}>
                      <td>{seatPosition(assignment)}</td>
                      <td>{student.schoolNumber}</td>
                      <td>{student.fullName}</td>
                      <td>{student.className}</td>
                      <td>{exam.subject}</td>
                      <td className="signature-cell" />
                    </tr>
                  ))}</tbody>
                </table>
              </article>
            </Fragment>
          )
        })}
      </div>, document.body)}
    </div>
  )
}

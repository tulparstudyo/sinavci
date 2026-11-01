import type { Exam, ExamSession, Room, SeatAssignment, Student } from './types'

export interface BackupData {
  format: 'sinavci-backup'
  version: 1
  exportedAt: string
  institutionName: string
  students: Student[]
  rooms: Room[]
  examSessions: ExamSession[]
  exams: Exam[]
  assignments: SeatAssignment[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveId(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function hasUniqueIds(records: Array<{ id?: number }>): boolean {
  const ids = records.map((record) => record.id)
  return ids.every(isPositiveId) && new Set(ids).size === ids.length
}

function isStudent(value: unknown): value is Student {
  if (!isRecord(value)) return false
  return isPositiveId(value.id)
    && typeof value.className === 'string'
    && typeof value.schoolNumber === 'string'
    && typeof value.fullName === 'string'
    && (value.gender === 'K' || value.gender === 'E' || value.gender === 'B')
    && typeof value.createdAt === 'string'
}

function isRoom(value: unknown): value is Room {
  if (!isRecord(value)) return false
  return isPositiveId(value.id)
    && typeof value.name === 'string'
    && Number.isInteger(value.capacity) && Number(value.capacity) > 0
    && Number.isInteger(value.columns) && Number(value.columns) > 0
    && Number.isInteger(value.rowsPerColumn) && Number(value.rowsPerColumn) > 0
    && (value.gender === 'A' || value.gender === 'K' || value.gender === 'E' || value.gender === 'B')
}

function isExamSession(value: unknown): value is ExamSession {
  if (!isRecord(value)) return false
  return isPositiveId(value.id)
    && typeof value.title === 'string'
    && typeof value.examDate === 'string'
    && typeof value.startTime === 'string'
    && typeof value.endTime === 'string'
    && typeof value.createdAt === 'string'
}

function isExam(value: unknown): value is Exam {
  if (!isRecord(value)) return false
  return isPositiveId(value.id)
    && isPositiveId(value.sessionId)
    && typeof value.subject === 'string'
    && (value.examDate === undefined || typeof value.examDate === 'string')
    && typeof value.session === 'string'
    && Array.isArray(value.classNames)
    && value.classNames.every((className) => typeof className === 'string')
    && typeof value.separateByGender === 'boolean'
    && typeof value.createdAt === 'string'
}

function isAssignment(value: unknown): value is SeatAssignment {
  if (!isRecord(value)) return false
  return isPositiveId(value.id)
    && isPositiveId(value.examId)
    && isPositiveId(value.studentId)
    && isPositiveId(value.roomId)
    && Number.isInteger(value.column) && Number(value.column) > 0
    && Number.isInteger(value.row) && Number(value.row) > 0
    && (value.side === 'left' || value.side === 'right')
}

export function parseBackup(text: string): BackupData {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Dosya geçerli bir JSON yedeği değil.')
  }

  if (!isRecord(parsed)
    || parsed.format !== 'sinavci-backup'
    || parsed.version !== 1
    || typeof parsed.exportedAt !== 'string'
    || typeof parsed.institutionName !== 'string'
    || !Array.isArray(parsed.students)
    || !Array.isArray(parsed.rooms)
    || !Array.isArray(parsed.examSessions)
    || !Array.isArray(parsed.exams)
    || !Array.isArray(parsed.assignments)) {
    throw new Error('Yedek dosyasının biçimi veya sürümü desteklenmiyor.')
  }

  const { students, rooms, examSessions, exams, assignments } = parsed
  if (!students.every(isStudent)
    || !rooms.every(isRoom)
    || !examSessions.every(isExamSession)
    || !exams.every(isExam)
    || !assignments.every(isAssignment)) {
    throw new Error('Yedek dosyasında eksik veya geçersiz kayıtlar var.')
  }

  if (!hasUniqueIds(students)
    || !hasUniqueIds(rooms)
    || !hasUniqueIds(examSessions)
    || !hasUniqueIds(exams)
    || !hasUniqueIds(assignments)) {
    throw new Error('Yedek dosyasında yinelenen veya geçersiz kayıt kimlikleri var.')
  }

  const sessionIds = new Set(examSessions.map((session) => session.id))
  const examIds = new Set(exams.map((exam) => exam.id))
  const studentIds = new Set(students.map((student) => student.id))
  const roomIds = new Set(rooms.map((room) => room.id))
  if (exams.some((exam) => !sessionIds.has(exam.sessionId))
    || assignments.some((assignment) =>
      !examIds.has(assignment.examId)
      || !studentIds.has(assignment.studentId)
      || !roomIds.has(assignment.roomId),
    )) {
    throw new Error('Yedek dosyasındaki sınav, oturum, öğrenci veya derslik bağlantıları tutarsız.')
  }

  return {
    format: 'sinavci-backup',
    version: 1,
    exportedAt: parsed.exportedAt,
    institutionName: parsed.institutionName,
    students,
    rooms,
    examSessions,
    exams,
    assignments,
  }
}

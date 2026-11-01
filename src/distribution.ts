import { compareClassNames } from './classSort'
import type { Exam, Room, SeatAssignment, Student } from './types'

export type ExamDistribution = {
  examId: number
  assignments: Omit<SeatAssignment, 'id'>[]
}

export type DistributionResult =
  | {
      ok: true
      distributions: ExamDistribution[]
      relaxedGradePairs: number
      relaxedClassPairs: number
      relaxedClassSequences: number
    }
  | { ok: false; message: string }

interface Seat {
  room: Room
  column: number
  row: number
  side: 'left' | 'right'
  pairKey: string
  forwardKey: string
  backwardKey: string
}

interface OccupiedSeat extends Seat {
  student: Student
}

interface ScheduledStudent {
  exam: Exam
  student: Student
}

function seatCapacity(room: Room): number {
  return Math.min(room.capacity, room.columns * room.rowsPerColumn * 2)
}

function isStudentEligibleForRoom(student: Student, room: Room, exam: Exam): boolean {
  if (exam.separateByGender) return room.gender === student.gender
  return room.gender === 'A' || room.gender === student.gender
}

function createSeats(room: Room): Seat[] {
  const capacity = seatCapacity(room)
  const seats: Seat[] = []

  for (let column = 1; column <= room.columns; column += 1) {
    for (let row = 1; row <= room.rowsPerColumn; row += 1) {
      for (const side of ['left', 'right'] as const) {
        if (seats.length >= capacity) return seats
        seats.push({
          room,
          column,
          row,
          side,
          pairKey: `${room.id}:${column}:${row}`,
          forwardKey: `${room.id}:${column}:${row - 1}:${side}`,
          backwardKey: `${room.id}:${column}:${row + 1}:${side}`,
        })
      }
    }
  }
  return seats
}

function gradeOf(student: Student): number {
  const grade = Number(student.className.match(/^\d{1,2}/)?.[0])
  return Number.isFinite(grade) ? grade : 0
}

function sessionKey(exam: Exam): string {
  return `${exam.examDate ?? ''}\u0000${exam.session.trim()}`
}

function buildSessionDistribution(
  exams: Exam[],
  students: Student[],
  rooms: Room[],
): {
  distributions: ExamDistribution[]
  relaxedGradePairs: number
  relaxedClassPairs: number
  relaxedClassSequences: number
} | string {
  const classNames = [...new Set(exams.flatMap((exam) => exam.classNames))]
  const examRooms = rooms.filter((room) => classNames.includes(room.name))
  const missingRoomNames = classNames.filter((className) => !examRooms.some((room) => room.name === className))
  if (missingRoomNames.length > 0) {
    return `Seçili sınavlarda kullanılan şubeler için salon bulunamadı: ${missingRoomNames.join(', ')}. Salon listesini kontrol edin.`
  }
  if (examRooms.some((room) => room.id === undefined || room.capacity < 1 || room.columns < 1 || room.rowsPerColumn < 1)) {
    return 'Salonlardan birinin kimliği veya oturma kapasitesi geçersiz. Dağıtımdan önce salon ayarlarını kontrol edin.'
  }

  const scheduledStudents: ScheduledStudent[] = []
  for (const exam of exams) {
    if (exam.id === undefined) return 'Kaydedilmemiş bir sınav dağıtıma seçildi.'
    const examStudents = students.filter((student) => exam.classNames.includes(student.className))
    if (examStudents.length === 0) return `“${exam.subject}” sınavı için öğrenci bulunamadı.`
    for (const student of examStudents) {
      if (student.id === undefined) return `“${exam.subject}” sınavındaki bir öğrencinin kayıt numarası bulunamadı.`
      scheduledStudents.push({ exam, student })
    }
  }

  const seenStudentIds = new Set<number>()
  for (const { student } of scheduledStudents) {
    const studentId = student.id
    if (studentId === undefined) continue
    if (seenStudentIds.has(studentId)) {
      return `${student.className} şubesindeki ${student.fullName} öğrencisi aynı oturumda birden fazla sınava atanmış. Oturum planlarını kontrol edin.`
    }
    seenStudentIds.add(studentId)
  }

  for (const gender of ['K', 'E', 'B'] as const) {
    const genderEntries = scheduledStudents.filter(({ student }) => student.gender === gender)
    if (genderEntries.length === 0) continue
    const genderRooms = examRooms.filter((room) =>
      genderEntries.some(({ exam, student }) => isStudentEligibleForRoom(student, room, exam)),
    )
    const totalCapacity = genderRooms.reduce((total, room) => total + seatCapacity(room), 0)
    const label = gender === 'K' ? 'Kız' : gender === 'E' ? 'Erkek' : 'Cinsiyeti belirtilmemiş'
    if (totalCapacity < genderEntries.length) {
      const roomSummary = genderRooms.length > 0
        ? genderRooms.map((room) => `${room.name}: ${seatCapacity(room)} koltuk`).join(', ')
        : 'uygun salon yok'
      const shortage = genderEntries.length - totalCapacity
      return `Aynı oturumda dağıtılan sınavlardaki ${label} öğrenci sayısı ${genderEntries.length}; seçili ve cinsiyet uyumlu ortak salonlar (${roomSummary}) toplam ${totalCapacity} koltuk sunuyor. ${shortage} koltuk eksik. Sınavları birlikte dağıtmak için seçili sınavların şube salonları ortak kullanılır.`
    }

  }

  const seats = examRooms.flatMap(createSeats)
  const occupiedBySeat = new Map<string, OccupiedSeat>()
  const occupiedClassesByPair = new Map<string, Set<string>>()
  const occupiedGradesByPair = new Map<string, Set<number>>()
  const classCountsByRoom = new Map<string, number>()
  const roomCounts = new Map<number, number>()
  const assignmentsByExam = new Map<number, Omit<SeatAssignment, 'id'>[]>()
  const studentsByClass = new Map<string, number>()
  let relaxedGradePairs = 0
  let relaxedClassPairs = 0
  let relaxedClassSequences = 0

  for (const { student } of scheduledStudents) {
    studentsByClass.set(student.className, (studentsByClass.get(student.className) ?? 0) + 1)
  }

  const orderedStudents = [...scheduledStudents].sort((a, b) => {
    const classSizeDifference = (studentsByClass.get(b.student.className) ?? 0) -
      (studentsByClass.get(a.student.className) ?? 0)
    if (classSizeDifference !== 0) return classSizeDifference
    return compareClassNames(a.student.className, b.student.className) ||
      a.student.schoolNumber.localeCompare(b.student.schoolNumber, 'tr')
  })

  for (const { exam, student } of orderedStudents) {
    const grade = gradeOf(student)
    let bestSeat: Seat | undefined
    let bestScore = Number.POSITIVE_INFINITY

    for (const seat of seats) {
      const roomId = seat.room.id
      if (roomId === undefined || !isStudentEligibleForRoom(student, seat.room, exam)) continue
      const seatKey = `${roomId}:${seat.column}:${seat.row}:${seat.side}`
      if (occupiedBySeat.has(seatKey)) continue

      const pairClasses = occupiedClassesByPair.get(seat.pairKey)
      const pairGrades = occupiedGradesByPair.get(seat.pairKey)
      const pairSide = seat.side === 'left' ? 'right' : 'left'
      const sideStudent = occupiedBySeat.get(`${roomId}:${seat.column}:${seat.row}:${pairSide}`)?.student
      const classPairConflict = pairClasses?.has(student.className) ? 1 : 0
      const hasGradeConflict = grade > 0 && Boolean(pairGrades?.has(grade))

      const forwardStudent = occupiedBySeat.get(seat.forwardKey)?.student
      const backwardStudent = occupiedBySeat.get(seat.backwardKey)?.student
      const classSequenceConflict = Number(forwardStudent?.className === student.className) +
        Number(backwardStudent?.className === student.className)
      const gradeSequenceConflict = Number(Boolean(forwardStudent && gradeOf(forwardStudent) === grade)) +
        Number(Boolean(backwardStudent && gradeOf(backwardStudent) === grade))
      const classCount = classCountsByRoom.get(`${roomId}:${student.className}`) ?? 0
      const roomCount = roomCounts.get(roomId) ?? 0
      const score =
        (classPairConflict + classSequenceConflict) * 1_000_000_000 +
        Number(hasGradeConflict) * 10_000_000 +
        gradeSequenceConflict * 1_000_000 +
        classCount * 1_000 +
        roomCount * 10 +
        Number(Boolean(sideStudent && gradeOf(sideStudent) === grade))
      if (score < bestScore) {
        bestScore = score
        bestSeat = seat
      }
    }

    if (!bestSeat) {
      return `Aynı oturumdaki sınavlar ortak salonlara dağıtılırken ${student.className} şubesindeki ${student.fullName} öğrencisi için cinsiyet ve oturma kurallarına uygun koltuk bulunamadı. Ortak salon kapasitesini ve salon etiketlerini kontrol edin.`
    }

    const seat = bestSeat
    const studentId = student.id
    if (studentId === undefined || exam.id === undefined) return `“${exam.subject}” sınavındaki bir öğrencinin veya sınavın kayıt numarası bulunamadı.`
    const roomId = seat.room.id
    if (roomId === undefined) return 'Bir salonun kayıt numarası bulunamadı.'
    occupiedBySeat.set(`${roomId}:${seat.column}:${seat.row}:${seat.side}`, { ...seat, student })
    const pairClasses = occupiedClassesByPair.get(seat.pairKey) ?? new Set<string>()
    if (pairClasses.has(student.className)) relaxedClassPairs += 1
    pairClasses.add(student.className)
    occupiedClassesByPair.set(seat.pairKey, pairClasses)
    const pairGrades = occupiedGradesByPair.get(seat.pairKey) ?? new Set<number>()
    if (grade > 0 && pairGrades.has(grade)) relaxedGradePairs += 1
    if (grade > 0) pairGrades.add(grade)
    occupiedGradesByPair.set(seat.pairKey, pairGrades)
    if (
      occupiedBySeat.get(seat.forwardKey)?.student.className === student.className ||
      occupiedBySeat.get(seat.backwardKey)?.student.className === student.className
    ) relaxedClassSequences += 1
    const roomClassKey = `${roomId}:${student.className}`
    classCountsByRoom.set(roomClassKey, (classCountsByRoom.get(roomClassKey) ?? 0) + 1)
    roomCounts.set(roomId, (roomCounts.get(roomId) ?? 0) + 1)
    const examAssignments = assignmentsByExam.get(exam.id) ?? []
    examAssignments.push({
      examId: exam.id,
      studentId,
      roomId,
      column: seat.column,
      row: seat.row,
      side: seat.side,
    })
    assignmentsByExam.set(exam.id, examAssignments)
  }

  return {
    distributions: exams.flatMap((exam) => exam.id === undefined
      ? []
      : [{ examId: exam.id, assignments: assignmentsByExam.get(exam.id) ?? [] }]),
    relaxedGradePairs,
    relaxedClassPairs,
    relaxedClassSequences,
  }
}

export function createDistributions(exams: Exam[], students: Student[], rooms: Room[]): DistributionResult {
  if (exams.length === 0) return { ok: false, message: 'Dağıtım için en az bir sınav seçin.' }
  if (rooms.length === 0) return { ok: false, message: 'Dağıtım için kayıtlı sınav salonu bulunamadı.' }

  const examsBySession = new Map<string, Exam[]>()
  for (const exam of exams) {
    const group = examsBySession.get(sessionKey(exam)) ?? []
    group.push(exam)
    examsBySession.set(sessionKey(exam), group)
  }

  const distributions: ExamDistribution[] = []
  let relaxedGradePairs = 0
  let relaxedClassPairs = 0
  let relaxedClassSequences = 0
  for (const sessionExams of examsBySession.values()) {
    const sessionDistributions = buildSessionDistribution(sessionExams, students, rooms)
    if (typeof sessionDistributions === 'string') return { ok: false, message: sessionDistributions }
    distributions.push(...sessionDistributions.distributions)
    relaxedGradePairs += sessionDistributions.relaxedGradePairs
    relaxedClassPairs += sessionDistributions.relaxedClassPairs
    relaxedClassSequences += sessionDistributions.relaxedClassSequences
  }

  return { ok: true, distributions, relaxedGradePairs, relaxedClassPairs, relaxedClassSequences }
}

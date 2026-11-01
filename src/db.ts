import Dexie, { type EntityTable } from 'dexie'
import type { Exam, ExamSession, Room, SeatAssignment, Student } from './types'

class SinavciDatabase extends Dexie {
  students!: EntityTable<Student, 'id'>
  rooms!: EntityTable<Room, 'id'>
  examSessions!: EntityTable<ExamSession, 'id'>
  exams!: EntityTable<Exam, 'id'>
  assignments!: EntityTable<SeatAssignment, 'id'>

  constructor() {
    super('sinavci')
    this.version(1).stores({
      students: '++id, className, schoolNumber, fullName, gender',
      rooms: '++id, &name',
      exams: '++id, subject, session, *classNames',
      assignments: '++id, examId, studentId, roomId, [examId+roomId]',
    })
    this.version(2)
      .stores({
        students: '++id, className, schoolNumber, fullName, gender',
        rooms: '++id, &name',
        exams: '++id, subject, session, *classNames',
        assignments: '++id, examId, studentId, roomId, [examId+roomId]',
      })
      .upgrade(async (transaction) => {
        await transaction.table('rooms').toCollection().modify((room: Room) => {
          room.gender ??= 'A'
        })
      })
    this.version(3)
      .stores({
        students: '++id, className, schoolNumber, fullName, gender',
        rooms: '++id, &name',
        examSessions: '++id, examDate, title',
        exams: '++id, sessionId, subject, session, *classNames',
        assignments: '++id, examId, studentId, roomId, [examId+roomId]',
      })
      .upgrade(async (transaction) => {
        const examsTable = transaction.table('exams')
        const sessionsTable = transaction.table('examSessions')
        const exams = await examsTable.toArray() as Exam[]
        const groups = new Map<string, Exam[]>()
        exams.forEach((exam) => {
          const key = `${exam.examDate ?? ''}\u0000${exam.session.trim()}`
          const group = groups.get(key) ?? []
          group.push(exam)
          groups.set(key, group)
        })

        for (const group of groups.values()) {
          const firstExam = group[0]
          const timeMatches = [...firstExam.session.matchAll(/\b(\d{1,2}:\d{2})\b/g)]
          const sessionId = await sessionsTable.add({
            title: firstExam.session.trim() || 'Aktarılan oturum',
            examDate: firstExam.examDate ?? '',
            startTime: timeMatches[0]?.[1] ?? '',
            endTime: timeMatches[1]?.[1] ?? '',
            createdAt: firstExam.createdAt,
          }) as number
          await examsTable.where('id').anyOf(group.flatMap((exam) =>
            exam.id === undefined ? [] : [exam.id],
          )).modify({ sessionId })
        }
      })
  }
}

export const db = new SinavciDatabase()

export async function replaceStudentRoster(students: Student[]): Promise<void> {
  const studentCountsByClass = new Map<string, number>()
  const gendersByClass = new Map<string, Set<Student['gender']>>()
  students.forEach((student) => {
    studentCountsByClass.set(student.className, (studentCountsByClass.get(student.className) ?? 0) + 1)
    const genders = gendersByClass.get(student.className) ?? new Set<Student['gender']>()
    genders.add(student.gender)
    gendersByClass.set(student.className, genders)
  })
  const importedClasses = [...studentCountsByClass.keys()]

  await db.transaction('rw', db.students, db.rooms, async () => {
    const existingRooms = await db.rooms.toArray()
    const capacities = new Map(existingRooms.map((room) => [room.name, room]))

    await db.students.clear()
    await db.students.bulkAdd(students)

    const rooms: Room[] = importedClasses.map((name) => {
      const existing = capacities.get(name)
      const columns = existing?.columns ?? 3
      const studentCount = studentCountsByClass.get(name) ?? 0
      const genders = gendersByClass.get(name) ?? new Set<Student['gender']>()
      const detectedGender: Room['gender'] = genders.size === 1 ? [...genders][0] : 'A'
      return {
        name,
        capacity: studentCount,
        columns,
        rowsPerColumn: Math.max(existing?.rowsPerColumn ?? 1, Math.ceil(studentCount / (columns * 2))),
        gender: detectedGender,
      }
    })

    await db.rooms.clear()
    if (rooms.length > 0) await db.rooms.bulkAdd(rooms)
  })
}

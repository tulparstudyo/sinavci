export type Gender = 'K' | 'E' | 'B'
export type RoomGender = Gender | 'A'

export interface Student {
  id?: number
  className: string
  schoolNumber: string
  fullName: string
  gender: Gender
  createdAt: string
}

export interface Room {
  id?: number
  name: string
  capacity: number
  columns: number
  rowsPerColumn: number
  gender: RoomGender
}

export interface Exam {
  id?: number
  sessionId?: number
  subject: string
  examDate?: string
  session: string
  classNames: string[]
  separateByGender: boolean
  createdAt: string
}

export interface ExamSession {
  id?: number
  title: string
  examDate: string
  startTime: string
  endTime: string
  createdAt: string
}

export interface SeatAssignment {
  id?: number
  examId: number
  studentId: number
  roomId: number
  column: number
  row: number
  side: 'left' | 'right'
}

export interface ImportResult {
  students: Student[]
  rooms: Room[]
  importedCount: number
  classCount: number
}

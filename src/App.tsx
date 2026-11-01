import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ArrowRight, BookOpen, Check, Download, GraduationCap, MessageCircle, Plus, Printer, School, Settings2, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { db, replaceStudentRoster } from './db'
import { parseBackup, type BackupData } from './backup'
import { compareClassNames } from './classSort'
import { createDistributions } from './distribution'
import ExcelImport from './components/ExcelImport'
import Reports from './components/Reports'
import type { Exam, ExamSession, Room, RoomGender, Student } from './types'

const steps = [
  { number: '01', step: 1, label: 'Sınavları planla', icon: BookOpen },
  { number: '02', step: 2, label: 'Dağıtımı oluştur', icon: Sparkles },
  { number: '03', step: 3, label: 'Raporları yazdır', icon: Printer },
]

const defaultSubjects = [
  'Türk Dili ve Edebiyatı',
  'Matematik',
  'Fizik',
  'Kimya',
  'Biyoloji',
  'Tarih',
  'Coğrafya',
  'Felsefe',
  'İngilizce',
  'Din Kültürü ve Ahlak Bilgisi',
  'Beden Eğitimi',
  'Seçmeli Ders',
  'Diğer',
]

function parseSubjectList(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((subject) => subject.trim()).filter(Boolean))]
}

function getSavedSubjects(): string[] {
  const savedSubjects = localStorage.getItem('sinavci.subjects')
  const parsedSubjects = savedSubjects === null ? [] : parseSubjectList(savedSubjects)
  return parsedSubjects.length > 0 ? parsedSubjects : defaultSubjects
}

interface ExamDraft {
  id: string
  subject: string
  customSubject: string
  classNames: string[]
  separateByGender: boolean
}

function createExamDraft(subjects: string[]): ExamDraft {
  return {
    id: crypto.randomUUID(),
    subject: subjects[0] ?? '',
    customSubject: '',
    classNames: [],
    separateByGender: false,
  }
}

function sessionTimeLabel(session: ExamSession): string {
  if (session.startTime && session.endTime) return `${session.startTime} - ${session.endTime}`
  return session.startTime || session.endTime || session.title
}

function sessionDisplayName(session: ExamSession): string {
  return `${session.title} · ${session.examDate || 'Tarih belirtilmedi'} · ${sessionTimeLabel(session)}`
}

function getToday(): string {
  const today = new Date()
  const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 10)
}

export default function App() {
  const students = useLiveQuery(() => db.students.toArray(), [], [])
  const rooms = useLiveQuery(() => db.rooms.toArray(), [], [])
  const allExams = useLiveQuery(() => db.exams.toArray(), [], [])
  const allAssignments = useLiveQuery(() => db.assignments.toArray(), [], [])
  const sessions = useLiveQuery(() => db.examSessions.toArray(), [], [])
  const [activeSessionId, setActiveSessionId] = useState<number | null>(() => {
    const savedId = Number(localStorage.getItem('sinavci.activeSessionId'))
    return Number.isInteger(savedId) && savedId > 0 ? savedId : null
  })
  const [institutionName, setInstitutionName] = useState(() => localStorage.getItem('sinavci.institutionName') ?? '')
  const [subjects, setSubjects] = useState<string[]>(getSavedSubjects)
  const [subjectListText, setSubjectListText] = useState(() => subjects.join('\n'))
  const [focusSubjectList, setFocusSubjectList] = useState(false)
  const [isSubjectHelpOpen, setIsSubjectHelpOpen] = useState(false)
  const [isIntroVideoOpen, setIsIntroVideoOpen] = useState(
    () => localStorage.getItem('sinavci.hideIntroVideo') !== 'true',
  )
  const [hideIntroVideo, setHideIntroVideo] = useState(false)
  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const exams = allExams.filter((exam) => exam.sessionId === activeSessionId)
  const examIds = new Set(exams.flatMap((exam) => exam.id === undefined ? [] : [exam.id]))
  const assignments = allAssignments.filter((assignment) => examIds.has(assignment.examId))
  const classCount = new Set(students?.map((student) => student.className) ?? []).size
  const classNames = [...new Set(students.map((student) => student.className))].sort(compareClassNames)
  const studentById = new Map<number, Student>(students.flatMap((student) =>
    student.id === undefined ? [] : [[student.id, student] as const],
  ))
  const [activeStep, setActiveStep] = useState(0)
  const [examDrafts, setExamDrafts] = useState<ExamDraft[]>(() => [createExamDraft(subjects)])
  const [showSessionForm, setShowSessionForm] = useState(false)
  const [sessionTitle, setSessionTitle] = useState('Sabah Oturumu')
  const [sessionDate, setSessionDate] = useState(getToday)
  const [sessionStartTime, setSessionStartTime] = useState('09:00')
  const [sessionEndTime, setSessionEndTime] = useState('10:00')
  const [sessionError, setSessionError] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [settingsNotice, setSettingsNotice] = useState('')
  const [isExportingBackup, setIsExportingBackup] = useState(false)
  const [isImportingBackup, setIsImportingBackup] = useState(false)
  const backupInputRef = useRef<HTMLInputElement>(null)
  const subjectListRef = useRef<HTMLTextAreaElement>(null)
  const subjectHelpCloseRef = useRef<HTMLButtonElement>(null)
  const introVideoCloseRef = useRef<HTMLButtonElement>(null)
  const [roomError, setRoomError] = useState('')
  const [examError, setExamError] = useState('')
  const [examDeleteError, setExamDeleteError] = useState('')
  const [isSavingExam, setIsSavingExam] = useState(false)
  const [selectedExamIds, setSelectedExamIds] = useState<number[]>([])
  const [distributionError, setDistributionError] = useState('')
  const [isDistributing, setIsDistributing] = useState(false)
  const [distributionNotice, setDistributionNotice] = useState('')

  useEffect(() => {
    if (activeSessionId !== null && sessions.length > 0 && !sessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(null)
    }
  }, [sessions, activeSessionId])

  useEffect(() => {
    if (activeSessionId !== null) localStorage.setItem('sinavci.activeSessionId', String(activeSessionId))
    else localStorage.removeItem('sinavci.activeSessionId')
  }, [activeSessionId])

  useEffect(() => {
    if (activeStep !== 4 || !focusSubjectList) return
    subjectListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    subjectListRef.current?.focus({ preventScroll: true })
    setFocusSubjectList(false)
  }, [activeStep, focusSubjectList])

  useEffect(() => {
    if (!isSubjectHelpOpen) return
    subjectHelpCloseRef.current?.focus()
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsSubjectHelpOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isSubjectHelpOpen])

  useEffect(() => {
    if (!isIntroVideoOpen) return
    introVideoCloseRef.current?.focus()
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') closeIntroVideo()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isIntroVideoOpen, hideIntroVideo])

  useEffect(() => {
    const trimmedName = institutionName.trim()
    if (trimmedName) localStorage.setItem('sinavci.institutionName', trimmedName)
    else localStorage.removeItem('sinavci.institutionName')
  }, [institutionName])

  useEffect(() => {
    setExamDrafts((drafts) => drafts.map((draft) => ({
      ...draft,
      subject: subjects.includes(draft.subject) ? draft.subject : subjects[0] ?? '',
      classNames: draft.classNames.filter((className) => classNames.includes(className)),
    })))
  }, [classNames.join('|'), subjects])

  useEffect(() => {
    const savedIds = exams.flatMap((exam) => exam.id === undefined ? [] : [exam.id])
    setSelectedExamIds(savedIds)
    setDistributionError('')
    setDistributionNotice('')
  }, [activeSessionId, allExams])

  function saveSubjectList(value: string) {
    const nextSubjects = parseSubjectList(value)
    if (nextSubjects.length === 0) {
      setSettingsError('Ders listesinde en az bir ders adı bulunmalıdır.')
      setSettingsNotice('')
      return
    }

    try {
      const normalizedList = nextSubjects.join('\n')
      localStorage.setItem('sinavci.subjects', normalizedList)
      setSubjects(nextSubjects)
      setSubjectListText(normalizedList)
      setSettingsError('')
      setSettingsNotice('Ders listesi kaydedildi.')
    } catch (cause) {
      setSettingsError(cause instanceof Error ? `Ders listesi kaydedilemedi: ${cause.message}` : 'Ders listesi kaydedilemedi.')
      setSettingsNotice('')
    }
  }

  function openSubjectSettings() {
    setIsSubjectHelpOpen(true)
  }

  function goToSubjectSettings() {
    setIsSubjectHelpOpen(false)
    setFocusSubjectList(true)
    setActiveStep(4)
  }

  function closeIntroVideo() {
    if (hideIntroVideo) localStorage.setItem('sinavci.hideIntroVideo', 'true')
    else localStorage.removeItem('sinavci.hideIntroVideo')
    setIsIntroVideoOpen(false)
  }

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSessionError('')
    if (sessionEndTime <= sessionStartTime) {
      setSessionError('Oturum bitiş saati başlangıç saatinden sonra olmalıdır.')
      return
    }
    try {
      const session: ExamSession = {
        title: sessionTitle.trim(),
        examDate: sessionDate,
        startTime: sessionStartTime,
        endTime: sessionEndTime,
        createdAt: new Date().toISOString(),
      }
      const sessionId = await db.examSessions.add(session)
      if (typeof sessionId !== 'number') throw new Error('Veritabanı oturum kimliği döndürmedi.')
      setActiveSessionId(sessionId)
      setActiveStep(students.length > 0 ? 1 : 0)
      setExamDrafts([createExamDraft(subjects)])
      setShowSessionForm(false)
      setSessionTitle('Yeni Oturum')
    } catch (cause) {
      setSessionError(cause instanceof Error ? `Oturum oluşturulamadı: ${cause.message}` : 'Oturum oluşturulamadı.')
    }
  }

  async function deleteSession(session: ExamSession) {
    const sessionId = session.id
    if (sessionId === undefined) {
      setSessionError('Oturum silinemedi: Oturum kimliği bulunamadı.')
      return
    }

    const sessionExams = allExams.filter((exam) => exam.sessionId === sessionId)
    const examIds = sessionExams.flatMap((exam) => exam.id === undefined ? [] : [exam.id])
    const details = examIds.length > 0
      ? ` Bu oturuma bağlı ${examIds.length} sınav ve yerleşim kayıtları da silinecek.`
      : ''
    if (!window.confirm(`"${session.title}" oturumu silinsin mi?${details}`)) return

    setSessionError('')
    try {
      await db.transaction('rw', db.examSessions, db.exams, db.assignments, async () => {
        if (examIds.length > 0) {
          await db.assignments.where('examId').anyOf(examIds).delete()
          await db.exams.bulkDelete(examIds)
        }
        await db.examSessions.delete(sessionId)
      })
      if (activeSessionId === sessionId) {
        setActiveSessionId(null)
        setActiveStep(0)
      }
    } catch (cause) {
      setSessionError(cause instanceof Error ? `Oturum silinemedi: ${cause.message}` : 'Oturum silinemedi.')
    }
  }

  async function deleteAllSessions() {
    if (!window.confirm('Tüm oturumlar, bu oturumlara bağlı sınavlar ve yerleşim kayıtları silinecek. Öğrenci ve derslik listeleri korunacak. Devam edilsin mi?')) return
    setSettingsError('')
    try {
      await db.transaction('rw', db.examSessions, db.exams, db.assignments, async () => {
        await db.assignments.clear()
        await db.exams.clear()
        await db.examSessions.clear()
      })
      setActiveSessionId(null)
      setActiveStep(1)
      setSelectedExamIds([])
      setExamDrafts([createExamDraft(subjects)])
      setDistributionError('')
      setDistributionNotice('')
    } catch (cause) {
      setSettingsError(cause instanceof Error ? `Oturumlar silinemedi: ${cause.message}` : 'Oturumlar silinemedi.')
    }
  }

  async function exportBackup() {
    setSettingsError('')
    setSettingsNotice('')
    setIsExportingBackup(true)
    try {
      const [backupStudents, backupRooms, examSessions, backupExams, backupAssignments] = await Promise.all([
        db.students.toArray(),
        db.rooms.toArray(),
        db.examSessions.toArray(),
        db.exams.toArray(),
        db.assignments.toArray(),
      ])
      const backup: BackupData = {
        format: 'sinavci-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        institutionName: institutionName.trim(),
        students: backupStudents,
        rooms: backupRooms,
        examSessions,
        exams: backupExams,
        assignments: backupAssignments,
      }
      const file = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = 'sinav_yedek.json'
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setSettingsNotice('Yedek dosyası indirildi. Dosyayı diğer bilgisayara taşıyıp içe aktarabilirsiniz.')
    } catch (cause) {
      setSettingsError(cause instanceof Error ? `Yedek oluşturulamadı: ${cause.message}` : 'Yedek oluşturulamadı.')
    } finally {
      setIsExportingBackup(false)
    }
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return

    setSettingsError('')
    setSettingsNotice('')
    setIsImportingBackup(true)
    try {
      const backup = parseBackup(await file.text())
      const confirmed = window.confirm(
        `Bu işlem mevcut tüm öğrenci, derslik, oturum, sınav ve yerleşim verilerinin yerine yedekteki ${backup.students.length} öğrenci ve ${backup.examSessions.length} oturum bilgisini yükleyecek. Mevcut verilerinizin yedeğini aldığınızdan emin olun. Devam edilsin mi?`,
      )
      if (!confirmed) return

      await db.transaction('rw', db.students, db.rooms, db.examSessions, db.exams, db.assignments, async () => {
        await db.assignments.clear()
        await db.exams.clear()
        await db.examSessions.clear()
        await db.rooms.clear()
        await db.students.clear()
        if (backup.students.length > 0) await db.students.bulkPut(backup.students)
        if (backup.rooms.length > 0) await db.rooms.bulkPut(backup.rooms)
        if (backup.examSessions.length > 0) await db.examSessions.bulkPut(backup.examSessions)
        if (backup.exams.length > 0) await db.exams.bulkPut(backup.exams)
        if (backup.assignments.length > 0) await db.assignments.bulkPut(backup.assignments)
      })

      setInstitutionName(backup.institutionName)
      setActiveSessionId(null)
      setActiveStep(backup.examSessions.length > 0 ? 1 : 0)
      setSelectedExamIds([])
      setExamDrafts([createExamDraft(subjects)])
      setDistributionError('')
      setDistributionNotice('')
      setSettingsNotice('Yedek başarıyla yüklendi. Sınav planlamaya devam etmek için oturumu seçin.')
    } catch (cause) {
      setSettingsError(cause instanceof Error ? `Yedek yüklenemedi: ${cause.message}` : 'Yedek yüklenemedi.')
    } finally {
      setIsImportingBackup(false)
    }
  }

  async function clearAllData() {
    if (!window.confirm('Tüm öğrenci, derslik, oturum, sınav ve yerleşim verileri kalıcı olarak silinecek. Kurum adı ayarı da temizlenecek. Bu işlem geri alınamaz. Emin misiniz?')) return
    setSettingsError('')
    try {
      await db.transaction('rw', db.students, db.rooms, db.examSessions, db.exams, db.assignments, async () => {
        await db.assignments.clear()
        await db.exams.clear()
        await db.examSessions.clear()
        await db.rooms.clear()
        await db.students.clear()
      })
      localStorage.removeItem('sinavci.activeSessionId')
      localStorage.removeItem('sinavci.institutionName')
      setActiveSessionId(null)
      setInstitutionName('')
      setActiveStep(4)
      setSelectedExamIds([])
      setExamDrafts([createExamDraft(subjects)])
      setDistributionError('')
      setDistributionNotice('')
      setExamError('')
      setExamDeleteError('')
      setRoomError('')
    } catch (cause) {
      setSettingsError(cause instanceof Error ? `Veriler temizlenemedi: ${cause.message}` : 'Veriler temizlenemedi.')
    }
  }

  function selectSession(sessionId: number) {
    setActiveSessionId(sessionId)
    setActiveStep(students.length > 0 ? 1 : 0)
    setExamDrafts([createExamDraft(subjects)])
    setExamDeleteError('')
  }

  async function handleImport(importedStudents: Student[], importedInstitutionName?: string) {
    await replaceStudentRoster(importedStudents)
    if (importedInstitutionName) setInstitutionName(importedInstitutionName)
    setActiveStep(0)
  }

  function updateExamDraft(draftId: string, update: Partial<ExamDraft>) {
    setExamDrafts((drafts) => drafts.map((draft) =>
      draft.id === draftId ? { ...draft, ...update } : draft,
    ))
  }

  function addClassToExam(draftId: string, className: string) {
    setExamDrafts((drafts) => {
      const isAlreadyUsed = exams.some((exam) => exam.classNames.includes(className)) ||
        drafts.some((draft) => draft.id !== draftId && draft.classNames.includes(className))
      if (isAlreadyUsed) return drafts
      return drafts.map((draft) =>
        draft.id === draftId && !draft.classNames.includes(className)
          ? { ...draft, classNames: [...draft.classNames, className] }
          : draft,
      )
    })
  }

  function removeClassFromExam(draftId: string, className: string) {
    setExamDrafts((drafts) => drafts.map((draft) =>
      draft.id === draftId
        ? { ...draft, classNames: draft.classNames.filter((item) => item !== className) }
        : draft,
    ))
  }

  function addExamDraft() {
    setExamDrafts((drafts) => [...drafts, createExamDraft(subjects)])
  }

  async function handleExamSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!activeSession || activeSession.id === undefined) {
      setExamError('Önce sol menüden bir sınav oturumu oluşturun veya seçin.')
      return
    }

    const invalidDraft = examDrafts.find((draft) =>
      !(draft.subject === 'Diğer' ? draft.customSubject.trim() : draft.subject) ||
      draft.classNames.length === 0,
    )
    if (invalidDraft) {
      setExamError('Her sınav için ders adı ve en az bir şube seçin.')
      return
    }

    const assignedClassNames = new Set(exams.flatMap((exam) => exam.classNames))
    for (const draft of examDrafts) {
      const duplicateClassName = draft.classNames.find((className) => assignedClassNames.has(className))
      if (duplicateClassName) {
        setExamError(`${duplicateClassName} şubesi bu oturumda başka bir sınav dersine zaten atanmış.`)
        return
      }
      draft.classNames.forEach((className) => assignedClassNames.add(className))
    }

    setIsSavingExam(true)
    setExamError('')
    try {
      const createdAt = new Date().toISOString()
      const newExams: Exam[] = examDrafts.map((draft) => ({
        sessionId: activeSession.id,
        subject: draft.subject === 'Diğer' ? draft.customSubject.trim() : draft.subject,
        examDate: activeSession.examDate,
        session: sessionTimeLabel(activeSession),
        classNames: draft.classNames,
        separateByGender: draft.separateByGender,
        createdAt,
      }))
      await db.exams.bulkAdd(newExams)
      setExamDrafts([createExamDraft(subjects)])
    } catch (cause) {
      setExamError(cause instanceof Error ? `Sınavlar kaydedilemedi: ${cause.message}` : 'Sınavlar kaydedilemedi.')
    } finally {
      setIsSavingExam(false)
    }
  }

  async function updateRoom(roomId: number, changes: Partial<Room>) {
    setRoomError('')
    try {
      await db.rooms.update(roomId, changes)
    } catch (cause) {
      setRoomError(cause instanceof Error ? `Derslik güncellenemedi: ${cause.message}` : 'Derslik güncellenemedi.')
    }
  }

  function updateRoomDimension(roomId: number, field: 'capacity' | 'columns' | 'rowsPerColumn', value: string) {
    const parsedValue = Number(value)
    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
      setRoomError('Koltuk kapasitesi, kolon ve sıra değerleri en az 1 olan tam sayılar olmalıdır.')
      return
    }
    void updateRoom(roomId, { [field]: parsedValue })
  }

  async function deleteExam(exam: Exam) {
    const examId = exam.id
    if (examId === undefined) {
      setExamDeleteError('Sınav silinemedi: sınavın kayıt numarası bulunamadı.')
      return
    }
    if (!window.confirm(`“${exam.subject}” sınavını ve bu sınava ait dağıtımları silmek istiyor musunuz?`)) return

    setExamDeleteError('')
    try {
      await db.transaction('rw', db.exams, db.assignments, async () => {
        await db.assignments.where('examId').equals(examId).delete()
        await db.exams.delete(examId)
      })
      setSelectedExamIds((ids) => ids.filter((id) => id !== examId))
    } catch (cause) {
      setExamDeleteError(cause instanceof Error ? `Sınav silinemedi: ${cause.message}` : 'Sınav silinemedi.')
    }
  }

  async function handleDistribution() {
    const chosenExams = exams.filter((exam) => exam.id !== undefined && selectedExamIds.includes(exam.id))
    const result = createDistributions(chosenExams, students, rooms)
    if (!result.ok) {
      setDistributionError(result.message)
      setDistributionNotice('')
      return
    }

    setIsDistributing(true)
    setDistributionError('')
    setDistributionNotice('')
    try {
      const examIds = result.distributions.map((distribution) => distribution.examId)
      await db.transaction('rw', db.assignments, async () => {
        for (const examId of examIds) {
          await db.assignments.where('examId').equals(examId).delete()
        }
        const newAssignments = result.distributions.flatMap((distribution) => distribution.assignments)
        if (newAssignments.length > 0) await db.assignments.bulkAdd(newAssignments)
      })
      const assignedCount = result.distributions.reduce((sum, distribution) => sum + distribution.assignments.length, 0)
      const seatingNotes = [
        result.relaxedClassPairs > 0
          ? `Aynı şubeden öğrencilerin yan yana oturma kuralı ${result.relaxedClassPairs} masa çiftinde`
          : '',
        result.relaxedClassSequences > 0
          ? `Aynı şubeden öğrencilerin peş peşe oturma kuralı ${result.relaxedClassSequences} sıra konumunda`
          : '',
        result.relaxedGradePairs > 0
          ? `Aynı seviyeden öğrencilerin yan yana oturma kuralı ${result.relaxedGradePairs} masa çiftinde`
          : '',
      ].filter(Boolean)
      const seatingNote = seatingNotes.length > 0
        ? ` Zorunlu kapasite durumunda esnetilen kurallar: ${seatingNotes.join('; ')}.`
        : ''
      setDistributionNotice(`${result.distributions.length} sınav için ${assignedCount} öğrencinin salon ve oturma yeri kaydedildi.${seatingNote}`)
    } catch (cause) {
      setDistributionError(cause instanceof Error ? `Dağıtım kaydedilemedi: ${cause.message}` : 'Dağıtım kaydedilemedi.')
    } finally {
      setIsDistributing(false)
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Sınavcı ana sayfa">
          <span className="brand-mark"><GraduationCap size={22} strokeWidth={2.2} /></span>
          <span className="brand-name">sinav<span>ci</span><small>OKUL SINAV YÖNETİMİ</small></span>
        </a>
        <div className="session-sidebar">
          <div className="session-sidebar-heading">
            <span>OTURUMLAR</span>
            <button type="button" aria-label="Yeni oturum oluştur" title="Yeni oturum oluştur" onClick={() => setShowSessionForm((visible) => !visible)}>
              <Plus size={15} />
            </button>
          </div>
          <div className="session-sidebar-list">
            {sessions.map((session) => (
              <div className={`session-sidebar-row ${session.id === activeSessionId ? 'session-sidebar-item-active' : ''}`} key={session.id}>
                <button
                  className="session-sidebar-item"
                  type="button"
                  onClick={() => session.id !== undefined && selectSession(session.id)}
                >
                  <strong>{session.title}</strong>
                  <small>{session.examDate || 'Tarih belirtilmedi'} · {sessionTimeLabel(session)}</small>
                </button>
                <button
                  className="session-delete-button"
                  type="button"
                  aria-label={`${session.title} oturumunu sil`}
                  title="Oturumu sil"
                  onClick={() => void deleteSession(session)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {sessions.length === 0 && <span className="session-sidebar-empty">Henüz oturum yok.</span>}
          </div>
          {sessionError && <span className="session-form-error">{sessionError}</span>}
          {showSessionForm && (
            <form className="session-create-form" onSubmit={(event) => void createSession(event)}>
              <label>
                <span>Oturum adı</span>
                <input value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} required />
              </label>
              <label>
                <span>Gün</span>
                <input type="date" value={sessionDate} onChange={(event) => setSessionDate(event.target.value)} required />
              </label>
              <div className="session-time-fields">
                <label><span>Başlangıç</span><input type="time" value={sessionStartTime} onChange={(event) => setSessionStartTime(event.target.value)} required /></label>
                <label><span>Bitiş</span><input type="time" value={sessionEndTime} onChange={(event) => setSessionEndTime(event.target.value)} required /></label>
              </div>
              {sessionError && <span className="session-form-error">{sessionError}</span>}
              <button className="session-create-submit" type="submit"><Plus size={13} /> Oturum oluştur</button>
            </form>
          )}
          {sessionError && <span className="session-form-error">{sessionError}</span>}
        </div>
        <button className={`nav-item ${activeStep === 0 ? 'nav-item-active' : ''}`} type="button" onClick={() => setActiveStep(0)}>
          <School size={17} /> Öğrenci listeleri
        </button>
        <button className={`nav-item ${activeStep === 4 ? 'nav-item-active' : ''}`} type="button" onClick={() => setActiveStep(4)}>
          <Settings2 size={17} /> Ayarlar
        </button>
        <div className="sidebar-bottom">
          <div className="local-card"><ShieldCheck size={17} /><div><strong>Yerel ve güvenli</strong><span>Verileriniz cihazınızda kalır</span></div></div>
          <div className="version-label">Sınavcı <span>v0.1.0</span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <span>Çalışma alanı <b>/</b> {activeSession ? sessionDisplayName(activeSession) : 'Oturum seçilmedi'}</span>
          <span className="local-indicator"><i /> Çevrimdışı kullanıma hazır</span>
        </header>
        <div className="page-content">
          <div className="page-intro">
            <div>
              <div className="eyebrow"><span /> {activeStep === 0 ? 'ORTAK VERİ YÖNETİMİ' : 'YENİ SINAV DÖNEMİ'}</div>
              <h1>{activeStep === 0 ? 'Öğrenci listeleri' : activeStep === 4 ? 'Ayarlar' : 'Sınav planlama'}</h1>
              <p>{activeStep === 0 ? 'e-Okul listesini güncelleyin ve ortak derslik ayarlarını yönetin.' : activeStep === 4 ? 'Kurum bilgilerini ve yerel verileri yönetin.' : 'Sınavları planlayın, kelebek dağıtımını oluşturun ve raporları alın.'}</p>
            </div>
            <div className="term-badge"><span>AKTİF DÖNEM</span><strong>2026 – 2027</strong></div>
          </div>

          {activeStep !== 0 && activeStep !== 4 && <div className="mobile-session-switcher">
            <label>
              <span>Aktif oturum</span>
              <select
                value={activeSessionId ?? ''}
                onChange={(event) => {
                  const sessionId = Number(event.target.value)
                  if (Number.isInteger(sessionId) && sessionId > 0) selectSession(sessionId)
                }}
              >
                <option value="" disabled>Oturum seçin</option>
                {sessions.map((session) => <option key={session.id} value={session.id}>{sessionDisplayName(session)}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => setShowSessionForm(true)}><Plus size={14} /> Yeni oturum</button>
            {activeSession && <button className="mobile-session-delete" type="button" onClick={() => void deleteSession(activeSession)}><Trash2 size={14} /> Oturumu sil</button>}
            {showSessionForm && (
              <form className="mobile-session-create-form" onSubmit={(event) => void createSession(event)}>
                <label><span>Oturum adı</span><input value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} required /></label>
                <label><span>Gün</span><input type="date" value={sessionDate} onChange={(event) => setSessionDate(event.target.value)} required /></label>
                <label><span>Başlangıç</span><input type="time" value={sessionStartTime} onChange={(event) => setSessionStartTime(event.target.value)} required /></label>
                <label><span>Bitiş</span><input type="time" value={sessionEndTime} onChange={(event) => setSessionEndTime(event.target.value)} required /></label>
                {sessionError && <span className="session-form-error">{sessionError}</span>}
                <button className="session-create-submit" type="submit"><Plus size={13} /> Oturum oluştur</button>
              </form>
            )}
          </div>}
          {activeStep !== 0 && activeStep !== 4 && !activeSession && (
            <section className="session-selection-alert" role="alert">
              <div>
                <strong>Devam etmek için bir sınav oturumu seçin.</strong>
                <p>Sınav planlama, dağıtım ve raporlar seçilen oturuma kaydedilir. Öğrenci ve derslik listeleri ortak kalır.</p>
              </div>
              <label>
                <span>Oturum seçin</span>
                <select
                  value=""
                  disabled={sessions.length === 0}
                  onChange={(event) => {
                    const sessionId = Number(event.target.value)
                    if (Number.isInteger(sessionId) && sessionId > 0) selectSession(sessionId)
                  }}
                >
                  <option value="" disabled>{sessions.length === 0 ? 'Henüz oturum oluşturulmadı' : 'Oturum seçin'}</option>
                  {sessions.map((session) => <option key={session.id} value={session.id}>{sessionDisplayName(session)}</option>)}
                </select>
              </label>
              <button type="button" onClick={() => setShowSessionForm(true)}><Plus size={14} /> Oturum oluştur</button>
            </section>
          )}

          {activeStep !== 0 && activeStep !== 4 && <nav className="stepper" aria-label="Sınav planlama adımları">
            {steps.map(({ number, step, label, icon: Icon }) => (
              <button
                className={`step ${step === activeStep ? 'step-current' : ''} ${step < activeStep ? 'step-complete' : ''}`}
                key={number}
                type="button"
                disabled={
                  (step === 1 && (students.length === 0 || !activeSession)) ||
                  (step > 1 && exams.length === 0)
                }
                onClick={() => setActiveStep(step)}
              >
                <span className="step-icon">{step < activeStep ? <Check size={16} /> : <Icon size={16} />}</span>
                <span className="step-number">{number}</span><span className="step-label">{label}</span>
                {step < 3 && <span className="step-connector" />}
              </button>
            ))}
          </nav>}

          {activeStep === 4 ? (
            <section className="settings-panel">
              <div className="content-heading">
                <div className="heading-number"><Settings2 size={16} /></div>
                <div><h2>Kurum ve veri yönetimi</h2><p>Kurum adınız yazdırılabilir raporlarda görüntülenir.</p></div>
              </div>
              <label className="institution-name-field">
                <span>Kurum adı</span>
                <input
                  type="text"
                  value={institutionName}
                  onChange={(event) => setInstitutionName(event.target.value)}
                  placeholder="Örn. Atatürk Anadolu Lisesi"
                  maxLength={120}
                />
              </label>
              <section className="settings-backup">
                <div>
                  <h3>Başka bilgisayara aktar</h3>
                  <p>Öğrencileri, derslikleri, oturumları, sınavları ve yerleşimleri JSON yedeği olarak taşıyın. İçe aktarma bu bilgisayardaki mevcut verilerin yerine geçer.</p>
                </div>
                <div className="settings-backup-actions">
                  <button className="secondary-button" type="button" disabled={isExportingBackup || isImportingBackup} onClick={() => void exportBackup()}>
                    <Download size={15} /> {isExportingBackup ? 'Yedek hazırlanıyor…' : 'Dışa aktar'}
                  </button>
                  <button className="primary-button" type="button" disabled={isExportingBackup || isImportingBackup} onClick={() => backupInputRef.current?.click()}>
                    <Upload size={15} /> {isImportingBackup ? 'Yedek yükleniyor…' : 'İçe aktar'}
                  </button>
                  <input ref={backupInputRef} className="visually-hidden" type="file" accept=".json,application/json" onChange={(event) => void importBackup(event)} />
                </div>
              </section>
              {settingsNotice && <div className="success-message" role="status">{settingsNotice}</div>}
              <div className="settings-danger-zone">
                <div><h3>Oturum verileri</h3><p>Tüm oturumları, sınavları ve bu sınavlara ait salon yerleşimlerini siler. Öğrenci ve derslik tanımları korunur.</p></div>
                <button className="danger-button" type="button" disabled={sessions.length === 0 && allExams.length === 0 && allAssignments.length === 0} onClick={() => void deleteAllSessions()}>
                  <Trash2 size={15} /> Oturumları sil
                </button>
              </div>
              <div className="settings-danger-zone settings-danger-zone-critical">
                <div><h3>Tüm uygulama verileri</h3><p>Öğrenciler, derslikler, oturumlar, sınavlar, yerleşimler ve kurum adı ayarı silinir. Bu işlem geri alınamaz.</p></div>
                <button className="danger-button" type="button" disabled={students.length === 0 && rooms.length === 0 && sessions.length === 0 && allExams.length === 0 && allAssignments.length === 0 && !institutionName} onClick={() => void clearAllData()}>
                  <Trash2 size={15} /> Tüm datayı temizle
                </button>
              </div>
              {settingsError && <div className="error-message">{settingsError}</div>}
              <section className="subject-settings">
                <div>
                  <h3>Ders listesi</h3>
                  <p>Yeni ders eklemek için adını ayrı bir satıra yazıp kaydedin. Sınav planlamadaki ders seçenekleri bu listeden alınır.</p>
                </div>
                <label className="subject-list-field">
                  <span>Dersler</span>
                  <textarea
                    ref={subjectListRef}
                    value={subjectListText}
                    onChange={(event) => {
                      setSubjectListText(event.target.value)
                      setSettingsError('')
                      setSettingsNotice('')
                    }}
                    rows={10}
                    aria-label="Ders listesi"
                  />
                </label>
                <div className="subject-list-actions">
                  <button className="primary-button" type="button" onClick={() => saveSubjectList(subjectListText)}>
                    Ders listesini kaydet
                  </button>
                  <button className="secondary-button" type="button" onClick={() => saveSubjectList(defaultSubjects.join('\n'))}>
                    Varsayılan ders listesini yükle ve kaydet
                  </button>
                </div>
              </section>
            </section>
          ) : activeStep === 0 ? (
            <>
              <section className="content-heading">
                <div className="heading-number">01</div>
                <div><h2>Öğrenci listelerini içe aktarın</h2><p>e-Okul’dan aldığınız Excel dosyasını yükleyerek başlayın.</p></div>
              </section>

              <ExcelImport onImport={handleImport} />
              <section className="room-management-card">
                <div className="room-config-heading">
                  <div><h3>Ortak derslikler</h3><p>Öğrenci listesi yenilendiğinde şubeler ve derslikler birlikte güncellenir. Kapasite ve oturma düzeni dağıtımlarda kullanılır.</p></div>
                  <span>{rooms.length} derslik</span>
                </div>
                {roomError && <div className="error-message">{roomError}</div>}
                {rooms.length === 0 ? (
                  <div className="empty-classes">Derslikleri oluşturmak için önce öğrenci listesini içe aktarın.</div>
                ) : (
                  <div className="room-config-list">
                    {rooms.map((room) => (
                      <div className="room-config-row" key={room.id}>
                        <span className="room-config-name"><School size={15} />{room.name}</span>
                        <label className="room-config-field"><span>Koltuk</span><input aria-label={`${room.name} koltuk kapasitesi`} type="number" min="1" step="1" defaultValue={room.capacity} onBlur={(event) => room.id !== undefined && updateRoomDimension(room.id, 'capacity', event.currentTarget.value)} /></label>
                        <label className="room-config-field"><span>Kolon</span><input aria-label={`${room.name} kolon sayısı`} type="number" min="1" step="1" defaultValue={room.columns} onBlur={(event) => room.id !== undefined && updateRoomDimension(room.id, 'columns', event.currentTarget.value)} /></label>
                        <label className="room-config-field"><span>Sıra / kolon</span><input aria-label={`${room.name} kolon başına sıra sayısı`} type="number" min="1" step="1" defaultValue={room.rowsPerColumn} onBlur={(event) => room.id !== undefined && updateRoomDimension(room.id, 'rowsPerColumn', event.currentTarget.value)} /></label>
                        <label className="room-gender-field">
                          <span>Cinsiyet grubu</span>
                          <select
                            aria-label={`${room.name} salon cinsiyet etiketi`}
                            value={room.gender}
                            onChange={(event) => {
                              const gender = event.target.value as RoomGender
                              if (room.id !== undefined) void updateRoom(room.id, { gender })
                            }}
                          >
                            <option value="A">Kız / Erkek (karma)</option>
                            <option value="K">Kız salonu</option>
                            <option value="E">Erkek salonu</option>
                            <option value="B">Belirtilmemiş cinsiyet</option>
                          </select>
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : activeStep === 1 && !activeSession ? (
            <section className="exam-planner">
              <div className="content-heading">
                <div className="heading-number">01</div>
                <div><h2>Önce sınav oturumu oluşturun</h2><p>Sol menüden oturum ekleyip gün ve saatini belirleyin. Sınav planı ve dağıtım seçili oturuma kaydedilir.</p></div>
              </div>
              <button className="primary-button" type="button" onClick={() => setShowSessionForm(true)}><Plus size={15} /> Oturum oluştur</button>
            </section>
          ) : activeStep === 1 ? (
            <section className="exam-planner">
              <div className="content-heading">
                <div className="heading-number">01</div>
                <div><h2>Sınavları planlayın</h2><p>Dersleri ve sınava girecek şubeleri seçili oturuma ekleyin.</p></div>
              </div>
              <div className="active-session-banner"><strong>{activeSession?.title}</strong><span>{activeSession?.examDate || 'Tarih belirtilmedi'} · {activeSession ? sessionTimeLabel(activeSession) : ''}</span></div>
              <form className="exam-form" onSubmit={(event) => void handleExamSubmit(event)}>
                <div className="exam-drafts">
                  {examDrafts.map((draft, index) => {
                    const assignedStudents = students.filter((student) => draft.classNames.includes(student.className)).length
                    const availableClassNames = classNames.filter((className) =>
                      !exams.some((exam) => exam.classNames.includes(className)) &&
                      !examDrafts.some((otherDraft) =>
                        otherDraft.id !== draft.id && otherDraft.classNames.includes(className),
                      ),
                    )
                    return (
                      <article className="exam-draft-card" key={draft.id}>
                        <div className="exam-draft-heading">
                          <span className="exam-draft-number">{String(index + 1).padStart(2, '0')}</span>
                          <strong>Sınav dersi {index + 1}</strong>
                          {examDrafts.length > 1 && (
                            <button
                              className="remove-exam-button"
                              type="button"
                              onClick={() => setExamDrafts((drafts) => drafts.filter((item) => item.id !== draft.id))}
                            >
                              Dersi kaldır
                            </button>
                          )}
                        </div>
                        <div className="exam-form-grid">
                          <label className="exam-field">
                            <span>Ders adı</span>
                            <div className="exam-subject-control">
                              <select
                                value={draft.subject}
                                onChange={(event) => updateExamDraft(draft.id, { subject: event.target.value })}
                              >
                                {subjects.map((item) => <option key={item}>{item}</option>)}
                              </select>
                              <button className="subject-help-link" type="button" onClick={openSubjectSettings}>
                                Listede olmayan dersi nasıl eklerim
                              </button>
                            </div>
                          </label>
                          {draft.subject === 'Diğer' && (
                            <label className="exam-field">
                              <span>Özel ders adı</span>
                              <input
                                value={draft.customSubject}
                                onChange={(event) => updateExamDraft(draft.id, { customSubject: event.target.value })}
                                placeholder="Ders adını yazın"
                                required
                              />
                            </label>
                          )}
                        </div>
                        <div className="exam-class-heading">
                          <div>
                            <strong>Sınava girecek şubeler</strong>
                            <span>{draft.classNames.length} şube · {assignedStudents} öğrenci</span>
                          </div>
                          <button
                            className="text-button"
                            type="button"
                            onClick={() => updateExamDraft(draft.id, {
                              classNames: draft.classNames.length === availableClassNames.length
                                ? []
                                : availableClassNames,
                            })}
                          >
                            {draft.classNames.length === availableClassNames.length ? 'Seçimi temizle' : 'Tümünü seç'}
                          </button>
                        </div>
                        {classNames.length === 0 ? (
                          <div className="empty-classes">Önce öğrenci listesini içe aktarın.</div>
                        ) : (
                          <div className="class-select-grid">
                            {classNames.map((className) => {
                              const isSelected = draft.classNames.includes(className)
                              const isUsedElsewhere = !isSelected && !availableClassNames.includes(className)
                              return (
                                <button
                                  className={`class-select-card ${isSelected ? 'class-select-card-active' : ''} ${isUsedElsewhere ? 'class-select-card-disabled' : ''}`}
                                  key={className}
                                  type="button"
                                  aria-pressed={isSelected}
                                  disabled={isUsedElsewhere}
                                  title={isUsedElsewhere ? 'Bu şube başka bir sınav dersine atanmış.' : undefined}
                                  onClick={() => isSelected
                                    ? removeClassFromExam(draft.id, className)
                                    : addClassToExam(draft.id, className)}
                                >
                                  <span className="class-tag">{className}</span>
                                  {isSelected && <Check size={14} />}
                                </button>
                              )
                            })}
                          </div>
                        )}
                        <label className="gender-option">
                          <input
                            type="checkbox"
                            checked={draft.separateByGender}
                            onChange={(event) => updateExamDraft(draft.id, { separateByGender: event.target.checked })}
                          />
                          <span><strong>Kız ve erkek öğrencileri ayrı gruplara böl</strong><small>Dağıtım sırasında cinsiyet grupları birbirinden ayrı değerlendirilir.</small></span>
                        </label>
                      </article>
                    )
                  })}
                </div>
                <button className="add-exam-button" type="button" onClick={addExamDraft}>
                  <span>+</span> Başka bir sınav dersi ekle
                </button>
                {examError && <div className="error-message">{examError}</div>}
                <div className="exam-form-footer">
                  <button className="primary-button" type="submit" disabled={isSavingExam || !students.length}>
                    {isSavingExam ? 'Kaydediliyor...' : <><Check size={15} /> Tüm sınavları kaydet</>}
                  </button>
                </div>
              </form>
              {(exams?.length ?? 0) > 0 && (
                <div className="saved-exams">
                  <h3>Planlanan sınavlar <span>{exams?.length}</span></h3>
                  {examDeleteError && <div className="error-message">{examDeleteError}</div>}
                  {exams?.map((exam) => (
                    <div className="saved-exam-row" key={exam.id}>
                      <strong>{exam.subject}</strong>
                      <span>{activeSession ? sessionDisplayName(activeSession) : exam.session}</span>
                      <span>{[...exam.classNames].sort(compareClassNames).join(', ')}</span>
                      {exam.separateByGender && <span className="class-tag">Kız / Erkek ayrı</span>}
                      <button
                        className="delete-exam-button"
                        type="button"
                        aria-label={`${exam.subject} sınavını sil`}
                        title="Sınavı sil"
                        onClick={() => void deleteExam(exam)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : activeStep === 2 ? (
            <section className="distribution-planner">
              <div className="content-heading">
                <div className="heading-number">02</div>
                <div><h2>Sınav salonu dağıtımı</h2><p>Sınavları seçin ve oturma planını oluşturun. Ortak derslik ayarları öğrenci listeleri ekranından yönetilir.</p></div>
              </div>
              <div className="gender-room-notice">
                <ShieldCheck size={17} />
                <span><strong>Ortak salon havuzu</strong> — Dağıtım için uygun derslikler, öğrenci listeleri ekranındaki ortak derslik ayarlarından yönetilir. Kız/Erkek ayrımı açık olduğunda öğrenciler yalnızca aynı cinsiyete etiketli salonlara yerleştirilir.</span>
              </div>
              <div className="distribution-exams-heading">
                <div><h3>Dağıtılacak sınavlar</h3><p>{selectedExamIds.length} sınav seçili</p></div>
                <button className="text-button" type="button" onClick={() => setSelectedExamIds(selectedExamIds.length === exams.length ? [] : exams.flatMap((exam) => exam.id === undefined ? [] : [exam.id]))}>
                  {selectedExamIds.length === exams.length ? 'Seçimi temizle' : 'Tümünü seç'}
                </button>
              </div>
              {exams.length === 0 ? (
                <div className="empty-classes">Önce 02. adımda en az bir sınavı kaydedin.</div>
              ) : (
                <div className="distribution-exam-list">
                  {exams.map((exam) => {
                    const examId = exam.id
                    if (examId === undefined) return null
                    const studentCount = students.filter((student) => exam.classNames.includes(student.className)).length
                    const isSelected = selectedExamIds.includes(examId)
                    const assignedCount = assignments.filter((assignment) => assignment.examId === examId).length
                    return (
                      <label className={`distribution-exam-row ${isSelected ? 'distribution-exam-row-selected' : ''}`} key={examId}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => setSelectedExamIds((current) => isSelected
                            ? current.filter((id) => id !== examId)
                            : [...current, examId])}
                        />
                        <span className="distribution-exam-info">
                          <strong>{exam.subject}</strong>
                          <small>{exam.examDate ?? 'Tarih belirtilmedi'} · {exam.session} · {[...exam.classNames].sort(compareClassNames).join(', ')}</small>
                        </span>
                        <span className="distribution-exam-count">{assignedCount ? `${assignedCount} / ${studentCount} yerleşti` : `${studentCount} öğrenci`}</span>
                        {exam.separateByGender && <span className="class-tag">Kız / Erkek ayrı</span>}
                      </label>
                    )
                  })}
                </div>
              )}
              {distributionError && <div className="error-message">{distributionError}</div>}
              {distributionNotice && <div className="success-message"><Check size={16} />{distributionNotice}</div>}
              <div className="distribution-footer">
                <button className="back-button" type="button" onClick={() => setActiveStep(1)}><ArrowLeft size={15} /> Sınav planına dön</button>
                <button className="primary-button" type="button" onClick={() => void handleDistribution()} disabled={isDistributing || selectedExamIds.length === 0}>
                  {isDistributing ? 'Dağıtılıyor...' : <><Sparkles size={15} /> Dağıtımı başlat</>}
                </button>
              </div>
              {assignments.length > 0 && (
                <div className="assignment-summary">
                  <h3>Oluşturulan yerleşimler <small>Salon adı ve öğrencilerin şubesi ayrı gösterilir.</small></h3>
                  {exams.filter((exam) => exam.id !== undefined && assignments.some((assignment) => assignment.examId === exam.id)).map((exam) => {
                    const examId = exam.id
                    if (examId === undefined) return null
                    const examClassNames = new Set(exam.classNames)
                    const examStudentIds = new Set<number>()
                    students.forEach((student) => {
                      if (examClassNames.has(student.className) && student.id !== undefined) {
                        examStudentIds.add(student.id)
                      }
                    })
                    const examAssignments = assignments.filter((assignment) =>
                      assignment.examId === examId && examStudentIds.has(assignment.studentId),
                    )
                    const classCountsByRoom = new Map<number, Map<string, number>>()
                    examAssignments.forEach((assignment) => {
                      const student = studentById.get(assignment.studentId)
                      if (!student) return
                      const counts = classCountsByRoom.get(assignment.roomId) ?? new Map<string, number>()
                      counts.set(student.className, (counts.get(student.className) ?? 0) + 1)
                      classCountsByRoom.set(assignment.roomId, counts)
                    })
                    return (
                      <div className="assignment-exam-summary" key={examId}>
                        <strong>{exam.subject}</strong>
                        <span>{exam.examDate ?? 'Tarih belirtilmedi'} · {examAssignments.length} öğrenci · Şubeler: {[...exam.classNames].sort(compareClassNames).join(', ')}</span>
                        <div>{rooms.map((room) => {
                          const roomId = room.id
                          if (roomId === undefined) return null
                          const classCounts = classCountsByRoom.get(roomId)
                          if (!classCounts) return null
                          const roomCount = [...classCounts.values()].reduce((total, count) => total + count, 0)
                          const classBreakdown = [...classCounts.entries()]
                            .sort(([a], [b]) => compareClassNames(a, b))
                            .map(([className, count]) => `${className}: ${count}`)
                            .join(', ')
                          return <span className="class-tag" key={roomId}>Salon {room.name}: {roomCount} öğrenci ({classBreakdown})</span>
                        })}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          ) : (
            <section className="distribution-planner">
              <div className="content-heading">
                <div className="heading-number">03</div>
                <div><h2>Raporları yazdır</h2><p>Sınav dağıtımlarınız için hazırlanacak raporları inceleyin.</p></div>
              </div>
              <Reports exams={exams} assignments={assignments} students={students} rooms={rooms} institutionName={institutionName.trim()} />
              <button className="back-button" type="button" onClick={() => setActiveStep(2)}><ArrowLeft size={15} /> Dağıtım ekranına dön</button>
            </section>
          )}

          {students.length > 0 && activeStep !== 4 && (
            <section className="roster-summary">
              {activeStep === 1 ? (
                <>
                  <div className="summary-title">
                    <div className="summary-icon"><BookOpen size={18} /></div>
                    <div><h3>{activeSession?.title ?? 'Sınav planı'}</h3><p>{activeSession ? sessionDisplayName(activeSession) : 'Aktif oturum seçilmedi.'}</p></div>
                  </div>
                  <div className="summary-stats">
                    <div><strong>{exams.length}</strong><span>KAYITLI SINAV</span></div>
                    <div><strong>{new Set(exams.flatMap((exam) => exam.classNames)).size}</strong><span>SINAVA GİRECEK ŞUBE</span></div>
                  </div>
                </>
              ) : (
                <>
                  <div className="summary-title"><div className="summary-icon"><School size={18} /></div><div><h3>Aktif öğrenci listeniz</h3><p>Veriler güvenli şekilde bu cihazda saklanıyor.</p></div></div>
                  <div className="summary-stats">
                    <div><strong>{students.length}</strong><span>ÖĞRENCİ</span></div>
                    <div><strong>{classCount}</strong><span>ŞUBE</span></div>
                    <div><strong>{rooms.length}</strong><span>SINAV SALONU</span></div>
                  </div>
                </>
              )}
              {activeStep !== 0 && <div className="step-navigation-footer">
                {(
                  <button className="back-button" type="button" onClick={() => setActiveStep(activeStep === 1 ? 0 : activeStep === 2 ? 1 : 2)}>
                    <ArrowLeft size={15} />
                    {activeStep === 1 ? 'Öğrenci listelerini içe aktarın' : activeStep === 2 ? 'Sınavları planla' : 'Sınav salonu dağıtımı'}
                  </button>
                )}
                {activeStep === 1 ? (
                  <div className="step-navigation-next">
                    <button className="next-step-button next-step-button-active" type="button" disabled={exams.length === 0} onClick={() => setActiveStep(2)}>
                      Sınav salonu dağıtımı <ArrowRight size={16} />
                    </button>
                  </div>
                ) : activeStep === 2 ? (
                  <button className="next-step-button next-step-button-active" type="button" disabled={assignments.length === 0} onClick={() => setActiveStep(3)}>
                    Raporları yazdır <ArrowRight size={16} />
                  </button>
                ) : (
                  <span />
                )}
              </div>}
            </section>
          )}

          <footer className="page-footer"><span>© 2026 Sınavcı</span><span>Liseler için yerel sınav planlama sistemi</span></footer>
        </div>
      </main>
      {isSubjectHelpOpen && (
        <div className="subject-help-backdrop" onClick={() => setIsSubjectHelpOpen(false)}>
          <section
            className="subject-help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="subject-help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="subject-help-modal-heading">
              <h2 id="subject-help-title">Listede olmayan dersi nasıl eklerim?</h2>
              <button ref={subjectHelpCloseRef} className="subject-help-close" type="button" aria-label="Pencereyi kapat" onClick={() => setIsSubjectHelpOpen(false)}>
                <X size={17} />
              </button>
            </div>
            <p>Yeni ders adını Ayarlar’daki ders listesine ayrı satır olarak ekleyip kaydedin.</p>
            <button className="primary-button" type="button" onClick={goToSubjectSettings}>Ders listesi ayarlarına git</button>
          </section>
        </div>
      )}
      {isIntroVideoOpen && (
        <div className="intro-video-backdrop" onClick={closeIntroVideo}>
          <section
            className="intro-video-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="intro-video-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="intro-video-heading">
              <h2 id="intro-video-title">Tanıtım videosu</h2>
              <button ref={introVideoCloseRef} className="subject-help-close" type="button" aria-label="Pencereyi kapat" onClick={closeIntroVideo}>
                <X size={17} />
              </button>
            </div>
            <iframe
              className="intro-video-frame"
              src="https://www.youtube.com/embed/VEfn_l858i8?si=BCDPb9SQNuJoTuMF"
              title="YouTube video player"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
            <label className="intro-video-hide-option">
              <input type="checkbox" checked={hideIntroVideo} onChange={(event) => setHideIntroVideo(event.target.checked)} />
              <span>Tekrar gösterme</span>
            </label>
          </section>
        </div>
      )}
      <a
        className="whatsapp-button"
        href="https://wa.me/905065989387"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="WhatsApp üzerinden sohbet başlat"
      >
        <MessageCircle size={19} aria-hidden="true" />
        <span>WhatsApp</span>
      </a>
    </div>
  )
}

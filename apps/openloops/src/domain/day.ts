import type { DateKey } from './dates'
import type { NotifyKind } from './nudges'

/** ข้อมูลของแต่ละวัน: เวลาประชุม/ธุระ, การแจ้งเตือนที่ส่งไปแล้ว, การปิดวันและการทบทวนสัปดาห์ */
export interface DayPlan {
  date: DateKey
  meetingMinutes: number
  sent?: Partial<Record<NotifyKind, string>>
  shutdownAt?: string
  note?: string
  reviewAt?: string
  /** นาทีไม่ว่างในเวลางานจาก Google Calendar (เก็บแค่จำนวน ไม่เก็บรายละเอียดนัด) */
  calendarMinutes?: number
}

export type DayPatch = Partial<Pick<DayPlan, 'shutdownAt' | 'note' | 'reviewAt'>>

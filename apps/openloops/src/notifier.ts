import type { NotifyMessage } from './domain/nudges'

// แจ้งเตือนบนเครื่องผ่าน service worker ไม่มี server จึงทำงานเฉพาะตอนที่แอปเปิดอยู่ (ย่อหน้าต่างไว้ได้)

export type PermissionState = NotificationPermission | 'unsupported'

export function permissionState(): PermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

/** ต้องเรียกจากการกดปุ่มของผู้ใช้ browser ถึงจะยอมแสดงหน้าขอสิทธิ์ */
export async function requestPermission(): Promise<PermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  return Notification.requestPermission()
}

export async function showNotification(message: NotifyMessage, tag: string): Promise<boolean> {
  if (permissionState() !== 'granted') return false
  const options: NotificationOptions = {
    body: message.body,
    tag,
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    lang: 'th',
    data: { url: '/' },
  }
  const registration = await navigator.serviceWorker?.getRegistration()
  if (registration) {
    await registration.showNotification(message.title, options)
  } else {
    new Notification(message.title, options)
  }
  return true
}

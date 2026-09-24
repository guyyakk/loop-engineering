// โหลดเข้า service worker ที่ vite-plugin-pwa สร้าง (workbox.importScripts)
// กดการแจ้งเตือนแล้วพากลับไปที่หน้าต่าง OpenLoops ที่เปิดอยู่ หรือเปิดใหม่ถ้าไม่มี
// ถ้าแจ้งเตือนชี้ไปหน้าเฉพาะ (เช่น #shutdown) จะส่ง hash ให้แอปเปิดหน้านั้น
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  const hash = new URL(url, self.location.origin).hash
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = windows.find((client) => 'focus' in client)
      if (!existing) return self.clients.openWindow(url)
      await existing.focus()
      if (hash) existing.postMessage({ type: 'openloops:navigate', hash })
    })(),
  )
})

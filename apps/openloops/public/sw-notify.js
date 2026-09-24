// โหลดเข้า service worker ที่ vite-plugin-pwa สร้าง (workbox.importScripts)
// กดการแจ้งเตือนแล้วพากลับไปที่หน้าต่าง OpenLoops ที่เปิดอยู่ หรือเปิดใหม่ถ้าไม่มี
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = windows.find((client) => 'focus' in client)
      if (existing) return existing.focus()
      return self.clients.openWindow(url)
    })(),
  )
})

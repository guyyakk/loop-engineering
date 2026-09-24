/** ให้ browser ดาวน์โหลดข้อความเป็นไฟล์ ต้องเรียกจากการกดของผู้ใช้ */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // ให้ browser เริ่มดาวน์โหลดก่อนค่อยคืนหน่วยความจำ
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

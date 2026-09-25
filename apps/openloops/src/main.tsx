import '@fontsource/ibm-plex-sans-thai/thai-400.css'
import '@fontsource/ibm-plex-sans-thai/thai-500.css'
import '@fontsource/ibm-plex-sans-thai/latin-400.css'
import '@fontsource/ibm-plex-sans-thai/latin-500.css'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { QuickApp } from './QuickApp'
import { requestPersistentStorage } from './db'
import { QUICK_WINDOW, hideWindow, onQuickCapture, windowLabel } from './desktop'

// แอป Windows มีหน้าต่างจดงานด่วนแยก ใช้หน้าเว็บเดียวกันแต่แสดงแค่ฟอร์ม
const quick = windowLabel() === QUICK_WINDOW

createRoot(document.getElementById('root')!).render(
  <StrictMode>{quick ? <QuickApp onHide={() => void hideWindow()} onShow={onQuickCapture} /> : <App />}</StrictMode>,
)

if (!quick) void requestPersistentStorage()

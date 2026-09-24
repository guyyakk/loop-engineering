import '@fontsource/ibm-plex-sans-thai/thai-400.css'
import '@fontsource/ibm-plex-sans-thai/thai-500.css'
import '@fontsource/ibm-plex-sans-thai/latin-400.css'
import '@fontsource/ibm-plex-sans-thai/latin-500.css'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { requestPersistentStorage } from './db'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

void requestPersistentStorage()

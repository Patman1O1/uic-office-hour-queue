import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter' // Theinhardt stand-in
import '@fontsource-variable/archivo/wdth.css' // Obviously stand-in (Archivo Expanded)
import '@fontsource-variable/azeret-mono' // Pitch Sans stand-in
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

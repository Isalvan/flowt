import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'
import { DocsView } from './components/docs/DocsView'

// Register service worker for PWA automatic updates
registerSW({ immediate: true })

const isDocsRoute = window.location.pathname === '/docs';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDocsRoute ? <DocsView /> : <App />}
  </StrictMode>,
)

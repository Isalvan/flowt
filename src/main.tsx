import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'
import { LazyDocsView } from './components/docs/LazyDocsView'

// Register service worker for PWA automatic updates
registerSW({ immediate: true })

const isDocsRoute = window.location.pathname === '/docs';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDocsRoute ? (
      <Suspense fallback={<div className="grid min-h-screen place-items-center bg-page text-ink-soft" role="status">Cargando documentación…</div>}>
        <LazyDocsView />
      </Suspense>
    ) : <App />}
  </StrictMode>,
)

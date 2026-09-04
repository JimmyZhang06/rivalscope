import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ScrollManager from './components/ScrollManager'
import './index.css'

if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ScrollManager />
      <App />
    </BrowserRouter>
  </StrictMode>,
)

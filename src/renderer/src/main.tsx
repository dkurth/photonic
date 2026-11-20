import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/space-mono/400.css'
import '@fontsource/space-mono/700.css'
import './theme/tokens.css'
import './app.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

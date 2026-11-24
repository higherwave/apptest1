import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/inter/opsz.css' // Inter, self-hosted, with the optical-size axis (large text gets the Display cut by itself)
import './index.scss'
import { App } from './App'
import { ProblemBanner } from './shell/ProblemBanner'
import { watchPage } from './shell/problems'
import './inputMode'

// Reads are cached by the CDN for a minute; keep the browser from refetching on every focus.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false, retry: 1 } } })

// Problems are watched and shown from a root of their own, so they still show when the app below fails to draw.
watchPage()
const problemRoot = document.createElement('div')
problemRoot.id = 'problem-root'
document.body.append(problemRoot)
createRoot(problemRoot).render(<ProblemBanner />)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

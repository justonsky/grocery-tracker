import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './app/App.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
})

// Persists the query cache to localStorage so the last-fetched dashboard/trip/
// list data still renders (visibly stale) if the local server drops off
// mid-session — this app is local-first relative to one shared server, not a
// per-device offline copy, so this is what "offline" resilience looks like here.
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'grocery-tracker-query-cache',
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 }}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
)

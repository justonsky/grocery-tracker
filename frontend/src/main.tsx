import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './app/App.tsx'
import { ConnectivityProvider } from './app/ConnectivityProvider.tsx'
import { SyncProvider } from './app/SyncProvider.tsx'
import { ToastProvider } from './components/ui/ToastProvider.tsx'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
})

// Bump this when the shape of anything in the persisted cache changes, so a
// stale/incompatible cache from an older build is discarded on load instead
// of crashing a screen that expects a field the old cache doesn't have.
const CACHE_BUSTER = 'v2-offline-outbox'

// Persists the query cache to localStorage so the last-fetched dashboard/trip/
// list data still renders (visibly stale) if the local server drops off
// mid-session — this app is local-first relative to one shared server, not a
// per-device offline copy, so this is what "offline" resilience looks like here.
// maxAge is 30 days, not 24h: a user away for a couple of days must not come
// home to what looks like all their offline work having vanished.
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'grocery-tracker-query-cache',
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 * 30, buster: CACHE_BUSTER }}
    >
      <ToastProvider>
        <ConnectivityProvider>
          <SyncProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </SyncProvider>
        </ConnectivityProvider>
      </ToastProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
)

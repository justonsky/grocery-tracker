import { Route, Routes, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { ConfirmProvider } from '../components/ui/ConfirmProvider'
import { ProfilePicker } from '../screens/ProfilePicker'
import { Dashboard } from '../screens/Dashboard'
import { History } from '../screens/History'
import { TripsIndex } from '../screens/TripsIndex'
import { TripEditor } from '../screens/TripEditor'
import { ItemDetail } from '../screens/ItemDetail'
import { ItemsPortal } from '../screens/ItemsPortal'
import { SettingsDialog } from '../screens/SettingsDialog'
import { AppShell } from './AppShell'
import { WrongServerBanner } from './WrongServerBanner'
import { useCurrentProfileId } from './useCurrentProfileId'
import { useConnectivity } from './ConnectivityProvider'
import type { SettingsState } from './settingsLink'

function AppContent() {
  const location = useLocation()
  const [currentProfileId, setCurrentProfileId] = useCurrentProfileId()
  const { status } = useConnectivity()
  const { data: profiles } = useQuery({
    queryKey: ['profiles'],
    queryFn: api.profiles.list,
  })

  // No profile list yet. Not `isLoading`: on a device's first visit the query sits
  // *paused* (not loading) until the connectivity probe finishes, and an empty
  // picker in that gap invites creating a duplicate profile.
  if (!profiles) {
    if (status === 'offline') {
      return (
        <div className="mx-auto max-w-[520px] px-5 py-16 text-center">
          <h1 className="text-[clamp(24px,4vw,32px)]">Grocery Tracker</h1>
          <p className="text-text/70">
            Can't reach your home server, and this device hasn't loaded your profiles yet. Connect to your home network and it will
            load automatically.
          </p>
        </div>
      )
    }
    return (
      <div className="mx-auto max-w-[960px] px-5 py-7" aria-busy="true" aria-label="Loading profiles">
        <div className="skel mb-6 h-6 w-45" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skel h-30" />
          ))}
        </div>
      </div>
    )
  }

  const currentProfile = profiles?.find((p) => p.id === currentProfileId)
  if (!currentProfile) {
    return <ProfilePicker onSelect={setCurrentProfileId} />
  }

  const profileId = currentProfile.id

  // Settings is a dialog over whatever page opened it, not a page of its own: that
  // page stays mounted underneath, so a half-filled trip or item form isn't lost.
  // (A settings URL with no page behind it falls back to the dashboard.)
  const settingsOpen = location.pathname === '/settings'
  const background = settingsOpen ? ((location.state as SettingsState | null)?.background ?? { ...location, pathname: '/' }) : location

  return (
    <AppShell profileId={profileId} onSwitchProfile={() => setCurrentProfileId(null)}>
      <Routes location={background}>
        <Route path="/" element={<Dashboard profileId={profileId} />} />
        <Route path="/history" element={<History profileId={profileId} />} />
        <Route path="/trips" element={<TripsIndex profileId={profileId} />} />
        <Route path="/trips/new" element={<TripEditor profileId={profileId} />} />
        <Route path="/trips/:tripId" element={<TripEditor profileId={profileId} />} />
        <Route path="/items" element={<ItemsPortal />} />
        <Route path="/items/:itemId" element={<ItemDetail />} />
      </Routes>
      {settingsOpen && <SettingsDialog profileId={profileId} />}
    </AppShell>
  )
}

export default function App() {
  return (
    <ConfirmProvider>
      <WrongServerBanner />
      <AppContent />
    </ConfirmProvider>
  )
}

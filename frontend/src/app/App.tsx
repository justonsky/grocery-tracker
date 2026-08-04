import { Route, Routes } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { ConfirmProvider } from '../components/ui/ConfirmProvider'
import { ProfilePicker } from '../screens/ProfilePicker'
import { Dashboard } from '../screens/Dashboard'
import { History } from '../screens/History'
import { ListsIndex } from '../screens/ListsIndex'
import { ListEditor } from '../screens/ListEditor'
import { TripEditor } from '../screens/TripEditor'
import { ItemDetail } from '../screens/ItemDetail'
import { SettingsDialog } from '../screens/SettingsDialog'
import { AppShell } from './AppShell'
import { useCurrentProfileId } from './useCurrentProfileId'

function AppContent() {
  const [currentProfileId, setCurrentProfileId] = useCurrentProfileId()
  const { data: profiles, isLoading: profilesLoading } = useQuery({
    queryKey: ['profiles'],
    queryFn: api.profiles.list,
  })

  if (profilesLoading) {
    return (
      <div className="mx-auto max-w-[960px] px-5 py-7">
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

  return (
    <AppShell profileId={profileId} onSwitchProfile={() => setCurrentProfileId(null)}>
      <Routes>
        <Route path="/" element={<Dashboard profileId={profileId} />} />
        <Route path="/history" element={<History profileId={profileId} />} />
        <Route path="/lists" element={<ListsIndex profileId={profileId} />} />
        <Route path="/lists/new" element={<ListEditor profileId={profileId} />} />
        <Route path="/lists/:listId" element={<ListEditor profileId={profileId} />} />
        <Route path="/trips/new" element={<TripEditor profileId={profileId} />} />
        <Route path="/trips/:tripId" element={<TripEditor profileId={profileId} />} />
        <Route path="/items/:itemId" element={<ItemDetail profileId={profileId} />} />
        <Route path="/settings" element={<SettingsDialog />} />
      </Routes>
    </AppShell>
  )
}

export default function App() {
  return (
    <ConfirmProvider>
      <AppContent />
    </ConfirmProvider>
  )
}

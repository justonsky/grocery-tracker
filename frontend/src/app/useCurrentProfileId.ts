import { useCallback, useState } from 'react'

const STORAGE_KEY = 'grocery-tracker-current-profile-id'

// Which profile is active is per-device state, not shared server config — it
// used to be a server-side setting, which meant selecting a profile on one
// device silently switched every other device's session too. Each browser
// now remembers its own choice locally.
export function useCurrentProfileId() {
  const [profileId, setProfileIdState] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY))

  const setProfileId = useCallback((id: string | null) => {
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, id)
    }
    setProfileIdState(id)
  }, [])

  return [profileId, setProfileId] as const
}

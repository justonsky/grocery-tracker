import { useCallback, useState } from 'react'

// Profile selection is in-memory only — per the design spec, users must select
// a profile each time they access the UI (hard page reload / new tab). This
// ensures they always see the ProfilePicker gate on entry, not auto-resuming
// from a stale localStorage selection.
export function useCurrentProfileId() {
  const [profileId, setProfileIdState] = useState<string | null>(null)

  const setProfileId = useCallback((id: string | null) => {
    setProfileIdState(id)
  }, [])

  return [profileId, setProfileId] as const
}

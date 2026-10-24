import { useCallback, useState } from 'react'
import { takeProfileAfterUpdate } from './updateResume'

// Taken once per page load (not in a useState initializer, which StrictMode runs twice).
const resumedProfileId = takeProfileAfterUpdate()

// Profile selection is in-memory only — per the design spec, users must select
// a profile each time they access the UI (hard page reload / new tab). This
// ensures they always see the ProfilePicker gate on entry, not auto-resuming
// from a stale localStorage selection. The one exception is the reload that
// installs a new build (useAppUpdate), which comes back to the same profile.
export function useCurrentProfileId() {
  const [profileId, setProfileIdState] = useState<string | null>(resumedProfileId)

  const setProfileId = useCallback((id: string | null) => {
    setProfileIdState(id)
  }, [])

  return [profileId, setProfileId] as const
}

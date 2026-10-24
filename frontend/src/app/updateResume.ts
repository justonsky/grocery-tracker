// A reload to pick up a new build shouldn't drop the user back at the profile picker the way a
// hand-made reload does (useCurrentProfileId). Just before that reload the profile is stashed
// here; the next page load takes it once. The URL survives a reload by itself.
const KEY = 'grocery-tracker-update-resume'
// Long enough for a reload, short enough that a stash left behind (the user cancelled the
// browser's "Leave site?" prompt) doesn't make a later reload skip the picker.
const MAX_AGE_MS = 30_000

type Stored = { profileId: string; at: number }

export function stashProfileForUpdate(profileId: string | null, storage: Storage = sessionStorage, now = Date.now()) {
  try {
    if (profileId) storage.setItem(KEY, JSON.stringify({ profileId, at: now } satisfies Stored))
    else storage.removeItem(KEY)
  } catch {
    // Storage blocked: the reload just lands on the picker.
  }
}

export function takeProfileAfterUpdate(storage: Storage = sessionStorage, now = Date.now()): string | null {
  try {
    const raw = storage.getItem(KEY)
    storage.removeItem(KEY)
    if (!raw) return null
    const { profileId, at } = JSON.parse(raw) as Partial<Stored>
    return typeof profileId === 'string' && typeof at === 'number' && now - at >= 0 && now - at <= MAX_AGE_MS ? profileId : null
  } catch {
    return null
  }
}

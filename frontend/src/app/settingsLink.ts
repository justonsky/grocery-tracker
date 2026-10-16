import type { Location } from 'react-router-dom'

// Router state carried by links to /settings: the page to keep rendered behind it.
export interface SettingsState {
  background?: Location
}

// Opening settings from settings (e.g. tapping the gear again) keeps the original page behind it.
export function settingsLinkState(location: Location): SettingsState {
  return { background: location.pathname === '/settings' ? (location.state as SettingsState | null)?.background : location }
}

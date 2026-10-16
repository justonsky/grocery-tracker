import { useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { settingsLinkState } from './settingsLink'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useTheme } from './useTheme'
import { useDocumentTheme } from './themes'
import { useToast } from '../components/ui/ToastProvider'
import { SyncStatusPill, SyncStatusStrip } from './SyncStatusIndicator'
import { SyncFailuresDialog } from './SyncFailuresDialog'
import { IosInstallHint } from './IosInstallHint'

// Small stroke icons (24px grid, drawn in currentColor). Decorative only — every
// control that uses one keeps a text label or an aria-label.
function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {children}
    </svg>
  )
}

const HOME_ICON = <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
const HISTORY_ICON = <path d="M4 6h16M4 12h16M4 18h10" />
const BAG_ICON = <path d="M5 8h14l-1.5 11h-11zM9 8a3 3 0 0 1 6 0" />
const GRID_ICON = <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
const GEAR_ICON = (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>
)
const SUN_ICON = (
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </>
)
const MOON_ICON = <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: HOME_ICON },
  { to: '/history', label: 'History', icon: HISTORY_ICON },
  { to: '/trips', label: 'Grocery Trips', icon: BAG_ICON },
  { to: '/items', label: 'Items', icon: GRID_ICON },
]

const tabClass = ({ isActive }: { isActive: boolean }) => `tab-link min-h-11 ${isActive ? 'tab-link-active' : ''}`

export function AppShell({
  profileId,
  onSwitchProfile,
  children,
}: {
  profileId: string
  onSwitchProfile: () => void
  children: ReactNode
}) {
  const { themeMode } = useTheme()
  const settingsState = settingsLinkState(useLocation())
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: profiles } = useQuery({ queryKey: ['profiles'], queryFn: api.profiles.list })
  const currentProfile = profiles?.find((p) => p.id === profileId)
  const [failuresOpen, setFailuresOpen] = useState(false)
  useDocumentTheme(currentProfile?.theme)

  // Cache warmer: mounting these here (not just lazily inside TripEditor)
  // means the full item/store/category lists are already in the
  // persisted cache by the time someone goes offline — autocomplete and the
  // editors still work from cache even with no connection.
  useQuery({ queryKey: ['categories'], queryFn: api.categories.list })
  useQuery({ queryKey: ['items'], queryFn: () => api.items.search() })
  useQuery({ queryKey: ['stores'], queryFn: () => api.stores.search() })

  const toggleTheme = async () => {
    const isDark = document.documentElement.classList.contains('dark')
    try {
      await api.settings.update({ themeMode: isDark ? 'light' : 'dark' })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    } catch {
      toast('error', "Couldn't save your theme preference — try again when you're back online.")
    }
  }

  return (
    // `group`: main's bottom padding grows while the mobile sync strip is showing
    // above the tab bar, so nothing ends up hidden behind the fixed bar.
    <div className="group min-h-screen bg-bg text-text">
      <IosInstallHint />
      {/* Desktop top nav — hidden below lg, the window is live-resizable so this
          must be a CSS breakpoint switch, not a one-time platform check. */}
      <nav className="hidden border-b border-divider bg-surface lg:block">
        <div className="nav mx-auto max-w-[1240px] gap-3 px-6 py-3">
          <span className="nav-brand">
            <img src="/favicon.svg" alt="" className="h-9 w-9 rounded-[10px]" />
            Grocery Tracker
          </span>
          {/* The page links as one grouped bar, set apart from the status/theme/profile controls. */}
          <div className="nav-links">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className="nav-link">
                {item.label}
              </NavLink>
            ))}
          </div>
          <span className="mx-1 h-6 w-px bg-divider" aria-hidden="true" />
          <SyncStatusPill onOpenFailures={() => setFailuresOpen(true)} />
          <button type="button" className="btn btn-ghost btn-icon text-text/70 hover:text-text" aria-label="Toggle theme" onClick={toggleTheme}>
            <Icon>{themeMode === 'dark' ? MOON_ICON : SUN_ICON}</Icon>
          </button>
          <NavLink
            to="/settings"
            state={settingsState}
            className={({ isActive }) => `btn btn-ghost btn-icon ${isActive ? 'bg-accent-800 text-accent-200' : 'text-text/70 hover:text-text'}`}
            aria-label="Settings"
          >
            <Icon>{GEAR_ICON}</Icon>
          </NavLink>
          {currentProfile && (
            <button
              type="button"
              aria-label="Switch profile"
              title="Switch profile"
              className="flex min-h-11 max-w-56 cursor-pointer items-center gap-2 rounded-full border border-divider bg-surface py-0 pr-3.5 pl-1.5 font-body text-sm font-semibold text-text transition-colors hover:bg-chip"
              onClick={onSwitchProfile}
            >
              <Avatar name={currentProfile.name} size={32} />
              <span className="truncate">{currentProfile.name}</span>
            </button>
          )}
        </div>
      </nav>

      <main className="max-lg:pb-[calc(6rem+env(safe-area-inset-bottom))] max-lg:group-has-[[data-sync-strip]]:pb-[calc(10rem+env(safe-area-inset-bottom))]">
        {children}
      </main>

      {/* Mobile bottom tab nav — hidden at lg and above. The status strip sits
          directly above it and is the mobile equivalent of the desktop pill
          (one connectivity surface per breakpoint, not both at once). */}
      <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
        <SyncStatusStrip onOpenFailures={() => setFailuresOpen(true)} />
        <nav className="flex gap-0.5 border-t border-divider bg-surface px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={tabClass}>
              <span className="tab-icon">
                <Icon>{item.icon}</Icon>
              </span>
              <span className="tab-label">{item.label}</span>
            </NavLink>
          ))}
          <NavLink to="/settings" state={settingsState} className={tabClass}>
            <span className="tab-icon">
              <Icon>{GEAR_ICON}</Icon>
            </span>
            <span className="tab-label">Settings</span>
          </NavLink>
        </nav>
      </div>

      {failuresOpen && <SyncFailuresDialog onClose={() => setFailuresOpen(false)} />}
    </div>
  )
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-accent-800 font-body font-bold text-accent-200"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials}
    </span>
  )
}

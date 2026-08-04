import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useTheme } from './useTheme'
import { useToast } from '../components/ui/ToastProvider'
import { SyncStatusPill, SyncStatusStrip } from './SyncStatusIndicator'
import { SyncFailuresDialog } from './SyncFailuresDialog'
import { IosInstallHint } from './IosInstallHint'

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: '⌂' },
  { to: '/history', label: 'History', icon: '≡' },
  { to: '/lists', label: 'Lists', icon: '☰' },
]

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
  const toast = useToast()
  const queryClient = useQueryClient()
  const { data: profiles } = useQuery({ queryKey: ['profiles'], queryFn: api.profiles.list })
  const currentProfile = profiles?.find((p) => p.id === profileId)
  const [failuresOpen, setFailuresOpen] = useState(false)

  // Cache warmer: mounting these here (not just lazily inside TripEditor/
  // ListEditor) means the full item/store/category lists are already in the
  // persisted cache by the time someone goes offline — autocomplete and the
  // editors still work from cache even with no connection.
  useQuery({ queryKey: ['categories'], queryFn: api.categories.list })
  useQuery({ queryKey: ['items', profileId], queryFn: () => api.items(profileId).search() })
  useQuery({ queryKey: ['stores', profileId], queryFn: () => api.stores(profileId).search() })

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
    <div className="min-h-screen bg-bg text-text">
      <IosInstallHint />
      {/* Desktop top nav — hidden below lg, the window is live-resizable so this
          must be a CSS breakpoint switch, not a one-time platform check. */}
      <nav className="nav hidden border-b border-divider lg:flex">
        <span className="nav-brand">Grocery Tracker</span>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}>
            {item.label}
          </NavLink>
        ))}
        <SyncStatusPill onOpenFailures={() => setFailuresOpen(true)} />
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Toggle theme" onClick={toggleTheme}>
          {themeMode === 'dark' ? '☾' : '☀'}
        </button>
        {currentProfile && (
          <button type="button" className="flex cursor-pointer items-center gap-2 border-none bg-transparent" onClick={onSwitchProfile}>
            <Avatar name={currentProfile.name} />
            <span className="text-sm">{currentProfile.name}</span>
          </button>
        )}
        <NavLink to="/settings" className="btn btn-ghost btn-icon" aria-label="Settings">
          ⚙
        </NavLink>
      </nav>

      <main className="pb-20 lg:pb-0">{children}</main>

      {/* Mobile bottom tab nav — hidden at lg and above. The status strip sits
          directly above it and is the mobile equivalent of the desktop pill
          (one connectivity surface per breakpoint, not both at once). */}
      <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">
        <SyncStatusStrip onOpenFailures={() => setFailuresOpen(true)} />
        <nav className="flex border-t border-divider bg-surface">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs no-underline ${isActive ? 'text-accent' : 'text-text/70'}`
              }
            >
              <span className="text-lg leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-xs no-underline ${isActive ? 'text-accent' : 'text-text/70'}`
            }
          >
            <span className="text-lg leading-none">⚙</span>
            Settings
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
      className="flex items-center justify-center rounded-full bg-accent-800 font-heading text-accent-100"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {initials}
    </span>
  )
}

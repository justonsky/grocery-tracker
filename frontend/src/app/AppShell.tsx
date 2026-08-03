import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useTheme } from './useTheme'
import { useOnlineStatus } from './useOnlineStatus'

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: '⌂' },
  { to: '/history', label: 'History', icon: '≡' },
  { to: '/lists', label: 'Lists', icon: '☰' },
]

export function AppShell({ profileId, children }: { profileId: string; children: ReactNode }) {
  const { themeMode } = useTheme()
  const isOnline = useOnlineStatus()
  const queryClient = useQueryClient()
  const { data: profiles } = useQuery({ queryKey: ['profiles'], queryFn: api.profiles.list })
  const currentProfile = profiles?.find((p) => p.id === profileId)

  const toggleTheme = () => {
    const isDark = document.documentElement.classList.contains('dark')
    api.settings.update({ themeMode: isDark ? 'light' : 'dark' }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['settings'] }),
    )
  }

  const openProfilePicker = () =>
    api.settings.update({ currentProfileId: null }).then(() =>
      queryClient.invalidateQueries({ queryKey: ['settings'] }),
    )

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Desktop top nav — hidden below lg, the window is live-resizable so this
          must be a CSS breakpoint switch, not a one-time platform check. */}
      <nav className="nav hidden border-b border-divider lg:flex">
        <span className="nav-brand">Grocery Tracker</span>
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'}>
            {item.label}
          </NavLink>
        ))}
        <span
          className={`tag flex items-center gap-1.5 ${isOnline ? 'tag-accent' : 'tag-neutral'}`}
          style={!isOnline ? { color: 'var(--color-danger)' } : undefined}
          title={isOnline ? 'Connected to your local server' : "Can't reach your local server — showing last-synced data"}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'currentcolor' }} />
          {isOnline ? 'Synced' : 'Offline'}
        </span>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Toggle theme" onClick={toggleTheme}>
          {themeMode === 'dark' ? '☾' : '☀'}
        </button>
        {currentProfile && (
          <button type="button" className="flex cursor-pointer items-center gap-2 border-none bg-transparent" onClick={openProfilePicker}>
            <Avatar name={currentProfile.name} />
            <span className="text-sm">{currentProfile.name}</span>
          </button>
        )}
        <NavLink to="/settings" className="btn btn-ghost btn-icon" aria-label="Settings">
          ⚙
        </NavLink>
      </nav>

      {!isOnline && (
        <div
          className="px-4 py-2 text-center text-xs"
          style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}
        >
          Can't reach your local server — showing last-synced data. Changes are disabled until you're back online.
        </div>
      )}

      <main className="pb-20 lg:pb-0">{children}</main>

      {/* Mobile bottom tab nav — hidden at lg and above. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-divider bg-surface lg:hidden">
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

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

// Applies AppSettings.ThemeMode ("system" | "light" | "dark") to the .dark class
// on <html>, which Tailwind's custom dark variant keys off (see index.css).
export function useTheme() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings.get })
  const themeMode = settings?.themeMode ?? 'system'

  useEffect(() => {
    const root = document.documentElement
    const apply = (isDark: boolean) => root.classList.toggle('dark', isDark)

    if (themeMode === 'dark') {
      apply(true)
      return
    }
    if (themeMode === 'light') {
      apply(false)
      return
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    apply(media.matches)
    const listener = (e: MediaQueryListEvent) => apply(e.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [themeMode])

  // Chart colors are a household setting like light/dark: data-chart on <html>
  // swaps --chart-1..4 (index.css). "fresh" is the default and sets nothing.
  const chartScheme = settings?.chartScheme ?? 'fresh'
  useEffect(() => {
    const root = document.documentElement
    if (chartScheme === 'fresh') delete root.dataset.chart
    else root.dataset.chart = chartScheme
  }, [chartScheme])

  return { themeMode }
}

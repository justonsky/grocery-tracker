import { useEffect, useState } from 'react'

// True at Tailwind's sm breakpoint and up (640px): the layouts that have room for columns.
export function useIsWide() {
  const query = '(min-width: 640px)'
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const listener = (e: MediaQueryListEvent) => setWide(e.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])
  return wide
}

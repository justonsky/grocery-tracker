import { useEffect, useRef } from 'react'
import { useBlocker, useLocation } from 'react-router-dom'
import { useConfirm } from '../components/ui/ConfirmProvider'

// Asks before an in-app navigation (a nav tab, Back, a link) or a tab close/reload
// throws away edits that haven't been saved. `isDirty` may be a function so a caller
// that saves and then navigates can read current state, not the last render's.
//
// Moving within the same page (query-string changes) and opening Settings — which is a
// dialog over this page, so nothing is lost — never prompt.
export function useUnsavedChangesGuard(isDirty: boolean | (() => boolean)) {
  const confirm = useConfirm()
  const dirtyRef = useRef(isDirty)
  dirtyRef.current = isDirty
  const check = () => (typeof dirtyRef.current === 'function' ? dirtyRef.current() : dirtyRef.current)

  const here = useLocation().pathname
  const hereRef = useRef(here)
  hereRef.current = here

  const blocker = useBlocker(
    ({ nextLocation }) => check() && nextLocation.pathname !== hereRef.current && nextLocation.pathname !== '/settings',
  )

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    let cancelled = false
    void confirm({
      title: 'Leave this page?',
      body: "You have unsaved changes. If you leave now, your edits will be lost.",
      confirmLabel: 'Leave and discard',
      cancelLabel: 'Keep editing',
    }).then((leave) => {
      if (cancelled) return
      if (leave) blocker.proceed()
      else blocker.reset()
    })
    return () => {
      cancelled = true
    }
  }, [blocker, confirm])

  // Closing or reloading the tab can't show our modal, so use the browser's own prompt.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!check()) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

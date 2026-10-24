import { useEffect, useId, useRef, type ReactNode } from 'react'

// Dialogs can stack (a confirm over Settings); only the top one answers Escape and keeps focus.
const open: HTMLElement[] = []

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Dialog({
  title,
  children,
  onClose,
  wide = false,
  flush = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  // A roomier dialog (recipes); flush drops the padding so a header image can run edge to edge
  // (and the dialog draws its own close button).
  wide?: boolean
  flush?: boolean
}) {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const dialog = ref.current!
    const before = document.activeElement as HTMLElement | null
    open.push(dialog)
    // The dialog itself takes focus, not its first field: on a phone that would pop the keyboard up.
    dialog.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (open[open.length - 1] !== dialog) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
      } else if (e.key === 'Tab') {
        const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
        if (items.length === 0) return e.preventDefault()
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || active === dialog)) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      open.splice(open.indexOf(dialog), 1)
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [])

  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className={`dialog outline-none ${wide ? 'dialog-wide' : ''} ${flush ? 'dialog-flush' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {flush ? (
          <div id={titleId} className="sr-only">
            {title}
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div id={titleId} className="dialog-title min-w-0 pt-1.5">
              {title}
            </div>
            <button type="button" className="btn btn-ghost btn-icon -mt-1.5 -mr-2.5 shrink-0" aria-label="Close" onClick={onClose}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

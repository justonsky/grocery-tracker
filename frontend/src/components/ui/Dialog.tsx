import { useId, type ReactNode } from 'react'

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
  // A roomier dialog (recipes); flush drops the padding so a header image can run edge to edge.
  wide?: boolean
  flush?: boolean
}) {
  const titleId = useId()
  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`dialog ${wide ? 'dialog-wide' : ''} ${flush ? 'dialog-flush' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div id={titleId} className={flush ? 'sr-only' : 'dialog-title'}>
          {title}
        </div>
        {children}
      </div>
    </div>
  )
}

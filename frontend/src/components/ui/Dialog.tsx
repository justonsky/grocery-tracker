import { useId, type ReactNode } from 'react'

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string
  children: ReactNode
  onClose: () => void
}) {
  const titleId = useId()
  return (
    <div
      className="dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div id={titleId} className="dialog-title">
          {title}
        </div>
        {children}
      </div>
    </div>
  )
}

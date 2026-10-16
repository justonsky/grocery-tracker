import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { Dialog } from './Dialog'

interface ConfirmOptions {
  title: string
  body?: string
  confirmLabel?: string
}

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null)

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    options: ConfirmOptions
    resolve: (value: boolean) => void
  } | null>(null)

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setState({ options, resolve })
      }),
    [],
  )

  const settle = (value: boolean) => {
    state?.resolve(value)
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <Dialog title={state.options.title} onClose={() => settle(false)}>
          {state.options.body && <p className="m-0 text-sm leading-relaxed text-text/80">{state.options.body}</p>}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => settle(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger" onClick={() => settle(true)}>
              {state.options.confirmLabel ?? 'Delete'}
            </button>
          </div>
        </Dialog>
      )}
    </ConfirmContext.Provider>
  )
}

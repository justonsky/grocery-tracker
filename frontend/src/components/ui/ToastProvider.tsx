import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type ToastType = 'success' | 'error'
interface Toast {
  id: string
  type: ToastType
  message: string
}

const ToastContext = createContext<((type: ToastType, message: string) => void) | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = Math.random().toString(36).slice(2, 9)
    setToasts((t) => [...t, { id, type, message }])
    setTimeout(() => setToasts((t) => t.filter((toast) => toast.id !== id)), 4200)
  }, [])

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      {/* Phone: under the header, so a toast never covers the bottom tabs or a screen's docked
          action bar (the trip editor's Save / Finish trip). Desktop: the bottom corner. */}
      <div className="pointer-events-none fixed top-[calc(env(safe-area-inset-top)+4.25rem)] right-4 left-4 z-50 flex flex-col items-end gap-2 sm:left-auto sm:max-w-96 lg:top-auto lg:bottom-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-center gap-2.5 rounded-[14px] border p-3 pl-3.5 text-sm font-medium text-text ${
              toast.type === 'error' ? 'border-danger/30 bg-danger-bg' : 'border-accent/30 bg-accent-800'
            }`}
            style={{ boxShadow: 'var(--shadow-md)', animation: 'toast-in 0.18s ease' }}
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`shrink-0 ${toast.type === 'error' ? 'text-danger' : 'text-accent-200'}`}
            >
              {toast.type === 'error' ? (
                <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" />
              ) : (
                <path d="M20 6 9 17l-5-5" />
              )}
            </svg>
            <span className="min-w-0 flex-1">{toast.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setToasts((t) => t.filter((x) => x.id !== toast.id))}
              className="-my-1 -mr-1.5 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-text/60 hover:bg-text/10 hover:text-text"
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

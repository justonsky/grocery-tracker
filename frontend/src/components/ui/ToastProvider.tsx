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
      {/* Cleared above the mobile bottom tab nav (see AppShell), flush to the
          corner on desktop where that nav doesn't exist. */}
      <div className="fixed right-4 bottom-20 z-50 flex max-w-80 flex-col gap-2 lg:bottom-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="flex items-center gap-2.5 rounded-md border bg-surface p-3 text-sm shadow-md"
            style={{
              borderColor: toast.type === 'error' ? 'var(--color-danger)' : 'var(--color-accent)',
              animation: 'toast-in 0.18s ease',
            }}
          >
            <span style={{ color: toast.type === 'error' ? 'var(--color-danger)' : 'var(--color-accent)' }}>
              {toast.type === 'error' ? '⚠' : '✓'}
            </span>
            <span className="flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => setToasts((t) => t.filter((x) => x.id !== toast.id))}
              className="cursor-pointer border-none bg-transparent text-text/60"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

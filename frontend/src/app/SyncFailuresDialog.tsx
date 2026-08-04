import { Dialog } from '../components/ui/Dialog'
import { useConfirm } from '../components/ui/ConfirmProvider'
import { useToast } from '../components/ui/ToastProvider'
import { useSync } from './SyncProvider'
import { timeAgo } from '../offline/timeAgo'
import type { OutboxOp } from '../offline/types'

export function SyncFailuresDialog({ onClose }: { onClose: () => void }) {
  const { failedOps, blockedOps, retryFailedOp, discardFailedOp, retryAllFailed } = useSync()
  const confirm = useConfirm()
  const toast = useToast()

  const discard = async (op: OutboxOp) => {
    const ok = await confirm({
      title: 'Discard this change?',
      body: `"${op.label}" will be permanently removed and never sent to your home server. This can't be undone.`,
      confirmLabel: 'Discard',
    })
    if (ok) {
      await discardFailedOp(op)
      toast('success', 'Discarded.')
    }
  }

  const retry = async (op: OutboxOp) => {
    await retryFailedOp(op)
  }

  const hasNothingToShow = failedOps.length === 0 && blockedOps.length === 0

  return (
    <Dialog title="Sync needs your attention" onClose={onClose}>
      {hasNothingToShow ? (
        <p className="text-sm text-text/70">Nothing needs attention right now.</p>
      ) : (
        <div className="grid gap-3">
          {failedOps.map((op) => (
            <div key={op.opId} className="rounded-md border border-divider p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{op.label}</div>
                  <div className="mt-0.5 text-xs" style={{ color: 'var(--color-danger)' }}>
                    {op.lastError?.detail ?? 'This change was rejected by your home server.'}
                  </div>
                  {op.lastError && <div className="mt-0.5 text-[11px] text-text/50">{timeAgo(op.lastError.at)}</div>}
                </div>
                <div className="flex flex-none gap-1.5">
                  <button type="button" className="btn btn-secondary px-2.5 py-1 text-xs" onClick={() => retry(op)}>
                    Retry
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost px-2.5 py-1 text-xs"
                    style={{ color: 'var(--color-danger)' }}
                    onClick={() => discard(op)}
                  >
                    Discard
                  </button>
                </div>
              </div>
            </div>
          ))}

          {blockedOps.map((op) => (
            <div key={op.opId} className="rounded-md border border-divider p-2.5">
              <div className="text-sm font-medium">{op.label}</div>
              <div className="mt-0.5 text-xs text-text/70">
                Waiting on another change above that needs your attention first — resolve that one and this will continue automatically.
              </div>
            </div>
          ))}
        </div>
      )}

      {failedOps.length > 0 && (
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => void retryAllFailed()}>
            Retry all
          </button>
        </div>
      )}

      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  )
}

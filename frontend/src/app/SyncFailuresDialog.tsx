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
        <p className="m-0 text-sm text-text/70">Nothing needs attention right now.</p>
      ) : (
        <div className="grid gap-2.5">
          {failedOps.map((op) => (
            <div key={op.opId} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 rounded-[14px] border border-danger/30 bg-danger-bg p-3">
              <div className="min-w-0 flex-1 basis-48">
                <div className="text-sm font-semibold text-text">{op.label}</div>
                <div className="mt-0.5 text-xs leading-snug text-danger">
                  {op.lastError?.detail ?? 'This change was rejected by your home server.'}
                </div>
                {op.lastError && <div className="mt-1 text-[11px] text-text/60">{timeAgo(op.lastError.at)}</div>}
              </div>
              <div className="flex flex-none gap-1.5">
                <button type="button" className="btn btn-secondary px-3 text-xs" onClick={() => retry(op)}>
                  Retry
                </button>
                <button type="button" className="btn btn-ghost px-3 text-xs text-danger hover:bg-danger/10" onClick={() => discard(op)}>
                  Discard
                </button>
              </div>
            </div>
          ))}

          {blockedOps.map((op) => (
            <div key={op.opId} className="rounded-[14px] border border-divider bg-surface p-3">
              <div className="text-sm font-semibold text-text">{op.label}</div>
              <div className="mt-0.5 text-xs leading-snug text-text/70">
                Waiting on another change above that needs your attention first — resolve that one and this will continue automatically.
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {failedOps.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={() => void retryAllFailed()}>
            Retry all
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Dialog>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../../api/client'
import type { Category, Item, ReceiptDraft, ReceiptLine } from '../../api/types'
import { CANVAS_BLOCKED, canvasExportWorks, loadImage } from '../../recipes'
import { mergeReceipt, pairWithPlanned, type ReceiptRow } from '../../receipts/merge'
import { quantityLabel } from '../../trips/quantity'
import type { DraftItem } from '../TripItemList'
import { Combobox, type ComboOption } from '../ui/Combobox'
import { Dialog } from '../ui/Dialog'
import { useToast } from '../ui/ToastProvider'
import { useConfirm } from '../ui/ConfirmProvider'

const money = (n: number) => `$${n.toFixed(2)}`
const MAX_SIDE = 2000
// What the server takes as it is (ReceiptService.MaxImageBytes, kept inside the reader's 10 MB
// base64 limit) and the reader's largest side, for a photo that can't be shrunk on the device.
const SEND_AS_IS_MAX_BYTES = 7 * 1024 * 1024
const SEND_AS_IS_MAX_SIDE = 8000
const SEND_AS_IS_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const EXTRA_NAMES: Record<string, string> = { tax: 'Tax', fee: 'Fees', tip: 'Tip', deposit: 'Bottle deposit' }

// What the merge did, for the editor to apply and announce.
export interface ReceiptMerged {
  items: DraftItem[]
  storeName: string
  date: string | null
  updated: number
  added: number
  learned: number
}

interface Row {
  lineId: string
  include: boolean
  itemName: string
  categoryId: string
  source: 'alias' | 'planned' | 'suggested' | 'new'
  plannedKey: string | null
}

// Shrinks a phone photo before upload: a receipt reads fine at 2000px, at a fraction of the size.
// Where the browser fakes canvas output, the photo goes as it is if the server can take it, and
// otherwise stops with a reason — never as the fake picture, which the reader can't read.
async function shrink(file: File): Promise<Blob> {
  const { image, url } = await loadImage(file)
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    if (scale === 1 && file.type === 'image/jpeg' && file.size < 4 * 1024 * 1024) return file
    if (!canvasExportWorks()) {
      const fits = SEND_AS_IS_TYPES.includes(file.type) && file.size <= SEND_AS_IS_MAX_BYTES &&
        Math.max(image.naturalWidth, image.naturalHeight) <= SEND_AS_IS_MAX_SIDE
      if (fits) return file
      throw new Error(`${CANVAS_BLOCKED}, so this photo can't be made small enough to send. Allow this site to read canvas data if your browser offers it, use another browser, or paste the receipt's text.`)
    }
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) throw new Error('could not encode')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())

// Receipt import, from the trip editor: read a photo (or pasted text), review what each line is,
// then merge it into the trip being edited (the shopper still saves the trip as usual).
export function ReceiptImport({
  storeName,
  stores,
  items,
  catalogue,
  categories,
  newKey,
  canSetDate,
  onMerged,
  onClose,
}: {
  storeName: string | null
  stores: string[]
  items: DraftItem[]
  catalogue: Item[] | undefined
  categories: Category[] | undefined
  newKey: () => string
  // A new, unsaved list may take the receipt's date.
  canSetDate: boolean
  onMerged: (merged: ReceiptMerged) => void
  onClose: () => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<'choose' | 'reading' | 'review'>('choose')
  const [pasted, setPasted] = useState('')
  const [showPaste, setShowPaste] = useState(false)
  const [draft, setDraft] = useState<ReceiptDraft | null>(null)
  const [store, setStore] = useState<string>(storeName ?? '')
  const [rows, setRows] = useState<Row[]>([])
  const [keepExtras, setKeepExtras] = useState(true)
  const [addDifference, setAddDifference] = useState(true)
  const [useDate, setUseDate] = useState(canSetDate)
  const [error, setError] = useState<string | null>(null)
  // Demos and tests only: ?receiptFixture=<name> asks a server running the fixture reader for that sample.
  const fixture = useMemo(() => new URLSearchParams(window.location.search).get('receiptFixture') ?? undefined, [])

  const otherCategory = categories?.find((c) => c.name === 'Other')?.id ?? categories?.[0]?.id ?? ''
  const options: ComboOption[] = useMemo(() => (catalogue ?? []).map((i) => ({ value: i.name, label: i.name })), [catalogue])
  const byName = useMemo(() => new Map((catalogue ?? []).map((i) => [i.name.trim().toLowerCase(), i])), [catalogue])

  // A line's item: a name learned from an earlier receipt first, then the trip's own unbought line,
  // then the model's suggestion, else a new item named after the line.
  // Lines the user has changed keep their changes when the rows are rebuilt for another store.
  const touchedRef = useRef(new Set<string>())
  const buildRows = (d: ReceiptDraft, forStore: string) => {
    const planned = pairWithPlanned(d.lines, items, forStore || null)
    const keep = (built: Row[]) => (previous: Row[]) =>
      built.map((row) => (touchedRef.current.has(row.lineId) ? (previous.find((p) => p.lineId === row.lineId) ?? row) : row))
    setRows(keep(
      d.lines
        .filter((l) => l.kind === 'item')
        .map((l): Row => {
          const plannedKey = planned.get(l.id) ?? null
          const plannedLine = plannedKey ? items.find((it) => it.key === plannedKey) : null
          if (l.match?.source === 'alias') {
            const same = plannedLine && plannedLine.itemName.trim().toLowerCase() === l.match.itemName.toLowerCase()
            return { lineId: l.id, include: true, itemName: l.match.itemName, categoryId: l.match.categoryId ?? otherCategory, source: 'alias', plannedKey: same ? plannedKey : null }
          }
          if (plannedLine) return { lineId: l.id, include: true, itemName: plannedLine.itemName, categoryId: plannedLine.categoryId, source: 'planned', plannedKey }
          if (l.match) return { lineId: l.id, include: true, itemName: l.match.itemName, categoryId: l.match.categoryId ?? l.categoryId ?? otherCategory, source: 'suggested', plannedKey: null }
          return { lineId: l.id, include: true, itemName: l.name ?? titleCase(l.text), categoryId: l.categoryId ?? otherCategory, source: 'new', plannedKey: null }
        }),
    ))
  }

  const startReview = (d: ReceiptDraft) => {
    setDraft(d)
    // The section's store when importing into one; else the household store the receipt matched.
    const chosen = storeName ?? stores.find((s) => s.toLowerCase() === (d.storeName ?? '').toLowerCase()) ?? d.storeName ?? ''
    setStore(chosen)
    buildRows(d, chosen)
    setStage('review')
  }

  const read = useMutation({
    mutationFn: async (input: { file?: File; text?: string }) =>
      input.file ? api.receipts.read(await shrink(input.file), fixture) : api.receipts.readText(input.text!, fixture),
    onMutate: () => {
      setError(null)
      setStage('reading')
    },
    onSuccess: startReview,
    onError: (e) => {
      setStage('choose')
      setError(e instanceof Error && e.message ? e.message : "Couldn't read that receipt. Try a clearer, flatter photo.")
    },
  })

  // Suggestions are per store (names learned at Aldi don't apply at BJ's).
  const changeStore = async (next: string) => {
    setStore(next)
    if (!draft) return
    try {
      const d = await api.receipts.get(draft.id, next)
      setDraft(d)
      buildRows(d, next)
    } catch {
      buildRows(draft, next)
    }
  }

  // Closing without applying throws the draft (and its photo) away.
  const discardRef = useRef<string | null>(null)
  useEffect(() => {
    discardRef.current = draft && stage === 'review' ? draft.id : null
  }, [draft, stage])
  useEffect(
    () => () => {
      if (discardRef.current) void api.receipts.discard(discardRef.current).catch(() => {})
    },
    [],
  )

  const lines = useMemo(() => new Map((draft?.lines ?? []).map((l) => [l.id, l])), [draft])
  const extras = (draft?.lines ?? []).filter((l) => l.kind !== 'item')
  const extraTotal = extras.reduce((sum, l) => sum + l.amount, 0)
  const included = rows.filter((r) => r.include)
  const missingName = included.some((r) => !r.itemName.trim())
  const difference = draft && !draft.totalsMatch ? Math.round(draft.difference * 100) / 100 : 0

  const apply = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error('nothing to apply')
      return api.receipts.apply(draft.id, {
        storeName: store.trim(),
        lines: included.map((r) => ({ lineId: r.lineId, itemName: r.itemName.trim(), categoryId: r.categoryId || null })),
      })
    },
    onSuccess: (result) => {
      discardRef.current = null
      void queryClient.invalidateQueries({ queryKey: ['item-aliases'] })
      void queryClient.invalidateQueries({ queryKey: ['items'] })
      const names = new Map(result.lines.map((l) => [l.lineId, l.itemName]))
      const receiptRows: ReceiptRow[] = included.map((r) => {
        const line = lines.get(r.lineId) as ReceiptLine
        return { itemName: names.get(r.lineId) ?? r.itemName.trim(), categoryId: r.categoryId, amount: line.amount, quantity: line.quantity, unit: line.unit, plannedKey: r.plannedKey }
      })
      const extraLines = [
        ...(keepExtras
          ? Object.entries(EXTRA_NAMES).map(([kind, itemName]) => ({
              itemName,
              categoryId: otherCategory,
              amount: Math.round(extras.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0) * 100) / 100,
            }))
          : []),
        ...(addDifference && difference > 0 ? [{ itemName: 'Unlisted purchases', categoryId: otherCategory, amount: difference }] : []),
      ]
      const merged = mergeReceipt(items, { storeName: store.trim(), rows: receiptRows, extras: extraLines, newKey })
      onMerged({ ...merged, storeName: store.trim(), date: useDate ? (draft?.date ?? null) : null, learned: result.aliasesLearned })
    },
    onError: () => toast('error', "Couldn't apply the receipt. Check you're connected and try again."),
  })

  const update = (lineId: string, patch: Partial<Row>) => {
    touchedRef.current.add(lineId)
    setRows((rs) => rs.map((r) => (r.lineId === lineId ? { ...r, ...patch } : r)))
  }

  // Leaving the review throws the read receipt away (see discardRef), so ask first.
  const confirm = useConfirm()
  const requestClose = async () => {
    if (stage === 'review') {
      const discard = await confirm({
        title: 'Discard this receipt?',
        body: 'Nothing has been added to the trip yet. Reading it again means taking the photo again.',
        confirmLabel: 'Discard receipt',
        cancelLabel: 'Keep reviewing',
      })
      if (!discard) return
    }
    onClose()
  }
  const sourceTag: Record<Row['source'], { label: string; cls: string }> = {
    alias: { label: 'Saved match', cls: 'tag-accent' },
    planned: { label: 'On your list', cls: 'tag-accent' },
    suggested: { label: 'Suggested', cls: 'tag-neutral' },
    new: { label: 'New item', cls: 'tag-outline' },
  }

  if (stage !== 'review' || !draft) {
    return (
      <Dialog title="Import a receipt" onClose={onClose}>
        <p className="m-0 text-sm text-text/80">
          Take a photo of the receipt (flat, the whole thing in view) or choose a screenshot. Claude reads it, then you check each line before anything
          goes on the trip. The photo is deleted once the receipt is applied.
        </p>
        {stage === 'reading' ? (
          <div className="grid justify-items-center gap-3 py-6 text-center" role="status" aria-live="polite">
            <div className="skel h-2 w-40 rounded-full" />
            <p className="m-0 text-sm text-text/80">Reading the receipt… this takes about 10–20 seconds.</p>
          </div>
        ) : (
          <div className="grid gap-2.5">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              aria-label="Receipt photo"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) read.mutate({ file })
              }}
            />
            <button type="button" className="btn btn-primary min-h-12" onClick={() => fileInput.current?.click()}>
              Take or choose a photo
            </button>
            {showPaste ? (
              <div className="field">
                <label htmlFor="receipt-text">Receipt text</label>
                <textarea
                  id="receipt-text"
                  className="input min-h-32 font-mono text-[13px]"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder="Paste an e-receipt here"
                />
                <button type="button" className="btn btn-secondary mt-2" disabled={!pasted.trim()} onClick={() => read.mutate({ text: pasted })}>
                  Read this text
                </button>
              </div>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={() => setShowPaste(true)}>
                Paste an e-receipt instead
              </button>
            )}
            {error && (
              <p role="alert" className="m-0 rounded-[12px] bg-danger-bg px-3.5 py-2.5 text-sm text-danger">
                {error}
              </p>
            )}
          </div>
        )}
        <div className="flex justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </Dialog>
    )
  }

  const storeChoices = [...new Set([...stores, ...(draft.storeName ? [draft.storeName] : []), ...(store ? [store] : [])])]

  return (
    <Dialog title="Check the receipt" onClose={() => void requestClose()} wide>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div className="field">
          <label htmlFor="receipt-store">Store</label>
          <select id="receipt-store" className="input" value={store} onChange={(e) => void changeStore(e.target.value)}>
            {!store && <option value="">Choose a store</option>}
            {storeChoices.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="text-sm text-text/70 sm:pb-2.5">
          {draft.storeRead && <>Printed: {draft.storeRead}</>}
          {draft.date && <> · {draft.date}</>}
        </div>
      </div>

      <div className={`rounded-[12px] px-3.5 py-2.5 text-sm ${draft.totalsMatch ? 'bg-accent-800 text-accent-200' : 'bg-highlight-bg text-highlight-ink'}`} role="status">
        {draft.total == null
          ? `The total isn't readable; the lines add up to ${money(draft.linesTotal)}.`
          : draft.totalsMatch
            ? `The lines add up to the total, ${money(draft.total)}.`
            : `The lines add up to ${money(draft.linesTotal)} but the total says ${money(draft.total)} — check the prices below.`}
      </div>

      <ul className="m-0 grid list-none gap-2 p-0">
        {rows.map((row) => {
          const line = lines.get(row.lineId)!
          const known = byName.get(row.itemName.trim().toLowerCase())
          const tag = known && row.source === 'new' ? { label: 'Existing item', cls: 'tag-neutral' } : sourceTag[row.source]
          const amount = quantityLabel(line.quantity, line.unit)
          const details = [amount, line.discount > 0 ? `${money(line.discount)} off` : null, line.code ? `#${line.code}` : null].filter(Boolean).join(' · ')
          return (
            <li
              key={row.lineId}
              className={`grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 rounded-[14px] border border-divider p-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-center ${row.include ? '' : 'opacity-60'}`}
            >
              <label className="flex h-11 w-11 items-center justify-center" title="Keep this line">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-accent"
                  aria-label={`Keep ${line.text}`}
                  checked={row.include}
                  onChange={(e) => update(row.lineId, { include: e.target.checked })}
                />
              </label>
              <div className="min-w-0 self-center">
                <div className="truncate font-mono text-[13px]">{line.text}</div>
                {details && <div className="text-xs text-text/60">{details}</div>}
              </div>
              <div className="self-center text-right font-semibold tabular-nums sm:order-last sm:w-20">{money(line.amount)}</div>
              <div className="col-span-3 grid min-w-0 gap-1 sm:col-span-1">
                <Combobox
                  className="input"
                  aria-label={`Item for ${line.text}`}
                  value={row.itemName}
                  options={options}
                  disabled={!row.include}
                  onChange={(text) => update(row.lineId, { itemName: text, source: 'new', plannedKey: null })}
                  onSelect={(o) =>
                    update(row.lineId, { itemName: o.value, source: 'suggested', plannedKey: null, categoryId: byName.get(o.value.toLowerCase())?.defaultCategoryId ?? row.categoryId })
                  }
                />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`tag ${tag.cls} text-[11px]`}>{tag.label}</span>
                  {!known && row.include && (
                    <select
                      className="input !w-auto !py-1 text-xs"
                      aria-label={`Category for ${row.itemName || line.text}`}
                      value={row.categoryId}
                      onChange={(e) => update(row.lineId, { categoryId: e.target.value })}
                    >
                      {categories?.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {extras.length > 0 && (
        <label className="flex min-h-11 items-center gap-2.5 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-accent" checked={keepExtras} onChange={(e) => setKeepExtras(e.target.checked)} />
          Add tax and fees ({money(extraTotal)}) as their own lines
        </label>
      )}
      {difference > 0 && (
        <label className="flex min-h-11 items-center gap-2.5 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-accent" checked={addDifference} onChange={(e) => setAddDifference(e.target.checked)} />
          Add the {money(difference)} difference as “Unlisted purchases”
        </label>
      )}
      {canSetDate && draft.date && (
        <label className="flex min-h-11 items-center gap-2.5 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-accent" checked={useDate} onChange={(e) => setUseDate(e.target.checked)} />
          Use the receipt's date ({draft.date}) for this trip
        </label>
      )}

      {/* Docked to the bottom of the dialog: a long receipt shouldn't mean scrolling to the end to finish. */}
      <div className="sticky -bottom-5 -mx-5 -mb-5 flex flex-wrap items-center justify-end gap-2 border-t border-divider bg-surface px-5 py-3">
        <span className="mr-auto text-sm text-text/70">
          {included.length} of {rows.length} lines kept · matched lines are ticked off as bought
        </span>
        <button type="button" className="btn btn-ghost" onClick={() => void requestClose()}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!store.trim() || missingName || apply.isPending} onClick={() => apply.mutate()}>
          {apply.isPending ? 'Adding…' : 'Add to trip'}
        </button>
      </div>
    </Dialog>
  )
}

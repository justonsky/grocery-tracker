import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { toPng } from 'html-to-image'
import { perUnit } from '../../trips/quantity'
import { api } from '../../api/client'
import type { Recipe } from '../../api/types'
import { useConnectivity } from '../../app/ConnectivityProvider'
import { recipePhotoUrl } from '../../recipes'
import { Dialog } from '../ui/Dialog'
import { useConfirm } from '../ui/ConfirmProvider'
import { useToast } from '../ui/ToastProvider'
import { BAG, CAMERA, CLOSE, COPY, IMAGE, PENCIL, RecipeIcon, SHARE, TRASH } from './icons'
import { RecipeShareCard, recipeToText } from './RecipeShare'
import { usePhotoPicker } from './usePhotoPicker'

const money = (n: number) => `$${n.toFixed(2)}`

function IconButton({ label, onClick, children, danger = false, pressed }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={pressed}
      className={`btn btn-icon border-divider bg-surface/95 shadow-sm backdrop-blur ${danger ? 'text-danger hover:bg-danger-bg' : 'text-text'} ${pressed ? 'border-accent' : ''}`}
      onClick={onClick}
    >
      <RecipeIcon>{children}</RecipeIcon>
    </button>
  )
}

// A recipe's own window: photo, description, items with household prices, and the actions —
// edit, change photo, share (image or text), delete — plus the main one, creating a shopping list.
export function RecipeDialog({ recipe, onClose, onEdit }: { recipe: Recipe; onClose: () => void; onEdit: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const confirm = useConfirm()
  const { status } = useConnectivity()
  const online = status === 'online'
  const [shareOpen, setShareOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const exportRef = useRef<HTMLDivElement>(null)
  const shareRef = useRef<HTMLDivElement>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['recipes'] })

  const upload = useMutation({
    mutationFn: (photo: Blob) => api.recipes.setPhoto(recipe.id, photo),
    onSuccess: () => {
      void refresh()
      toast('success', 'Photo updated.')
    },
    onError: () => toast('error', "Couldn't upload that photo. Check you're connected and try again."),
  })
  const removePhoto = useMutation({
    mutationFn: () => api.recipes.removePhoto(recipe.id),
    onSuccess: () => {
      void refresh()
      toast('success', 'Photo removed.')
    },
    onError: () => toast('error', "Couldn't remove the photo."),
  })
  const del = useMutation({
    mutationFn: () => api.recipes.delete(recipe.id),
    onSuccess: () => {
      void refresh()
      void queryClient.invalidateQueries({ queryKey: ['trip'] })
      void queryClient.invalidateQueries({ queryKey: ['trips'] })
      toast('success', 'Recipe deleted.')
      onClose()
    },
    onError: () => toast('error', "Couldn't delete this recipe."),
  })
  const picker = usePhotoPicker((photo) => upload.mutate(photo))

  const askDelete = async () => {
    const used = recipe.tripCount
    const ok = await confirm({
      title: `Delete “${recipe.name}”?`,
      body:
        used > 0
          ? `It will also come off the planned meals of the ${used} ${used === 1 ? 'trip' : 'trips'} that use it. Their shopping lists stay as they are.`
          : 'This permanently removes the recipe for everyone in the house.',
      confirmLabel: 'Delete recipe',
    })
    if (ok) del.mutate()
  }

  useEffect(() => {
    if (!shareOpen) return
    const away = (e: PointerEvent) => !shareRef.current?.contains(e.target as Node) && setShareOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setShareOpen(false))
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc, true)
    }
  }, [shareOpen])

  const copyText = async () => {
    setShareOpen(false)
    try {
      await navigator.clipboard.writeText(recipeToText(recipe))
      toast('success', 'Recipe copied to the clipboard.')
    } catch {
      toast('error', "Couldn't copy to the clipboard.")
    }
  }

  // Same approach as the trip share image: a fixed-width copy rendered only while saving.
  const exportImage = () => {
    setShareOpen(false)
    setExporting(true)
  }
  useEffect(() => {
    if (!exporting) return
    let cancelled = false
    void (async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const images = [...(exportRef.current?.querySelectorAll('img') ?? [])]
      await Promise.all(images.map((img) => (img.complete ? null : new Promise((r) => (img.onload = img.onerror = r)))))
      try {
        if (!exportRef.current) throw new Error('not rendered')
        const url = await toPng(exportRef.current, { pixelRatio: 2 })
        const a = document.createElement('a')
        a.href = url
        a.download = `${recipe.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'recipe'}.png`
        a.click()
      } catch {
        if (!cancelled) toast('error', "Couldn't export this recipe as an image.")
      } finally {
        if (!cancelled) setExporting(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [exporting]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasPhoto = recipe.photoVersion > 0
  const offlineTitle = online ? undefined : 'Reconnect to your home server to do this.'

  const actions = (
    <div className="flex items-center gap-2">
      <span title={offlineTitle}>
        <IconButton label="Edit recipe" onClick={() => online && onEdit()}>
          {PENCIL}
        </IconButton>
      </span>
      <span title={offlineTitle}>
        <IconButton label={hasPhoto ? 'Change photo' : 'Add photo'} onClick={() => online && picker.choose()}>
          {CAMERA}
        </IconButton>
      </span>
      <div ref={shareRef} className="relative">
        <IconButton label="Share recipe" pressed={shareOpen} onClick={() => setShareOpen((o) => !o)}>
          {SHARE}
        </IconButton>
        {shareOpen && (
          <div role="menu" aria-label="Share recipe" className="absolute top-12 right-0 z-10 grid w-56 gap-0.5 rounded-[12px] border border-divider bg-surface p-1.5 shadow-lg">
            <button type="button" role="menuitem" className="btn btn-ghost justify-start" onClick={exportImage}>
              <RecipeIcon>{IMAGE}</RecipeIcon>Export image (PNG)
            </button>
            <button type="button" role="menuitem" className="btn btn-ghost justify-start" onClick={() => void copyText()}>
              <RecipeIcon>{COPY}</RecipeIcon>Copy recipe as text
            </button>
          </div>
        )}
      </div>
      <span title={offlineTitle}>
        <IconButton label="Delete recipe" danger onClick={() => online && void askDelete()}>
          {TRASH}
        </IconButton>
      </span>
      <IconButton label="Close" onClick={onClose}>
        {CLOSE}
      </IconButton>
    </div>
  )

  return (
    <Dialog title={recipe.name} onClose={onClose} wide flush>
      {picker.ui}
      {hasPhoto ? (
        <div className="relative h-56 shrink-0 bg-chip sm:h-64">
          <img src={recipePhotoUrl(recipe.id, recipe.photoVersion)} alt="" className="h-full w-full object-cover" />
          <div className="absolute top-3 right-3">{actions}</div>
        </div>
      ) : (
        <div className="flex justify-end p-3 pb-0">{actions}</div>
      )}

      <div className="grid gap-4 p-5 pt-4 sm:px-6">
        <div>
          <h2 className="m-0 text-[26px] sm:text-[28px]" aria-hidden="true">
            {recipe.name}
          </h2>
          <div className="mt-1 text-[13px] text-text/70">
            {recipe.items.length} {recipe.items.length === 1 ? 'item' : 'items'}
            {recipe.tripCount > 0 ? ` · planned on ${recipe.tripCount} ${recipe.tripCount === 1 ? 'trip' : 'trips'}` : ' · not planned yet'}
          </div>
        </div>
        {recipe.description && <p className="m-0 text-[15px] leading-relaxed whitespace-pre-line text-text/90">{recipe.description}</p>}

        <div className="overflow-hidden rounded-[14px] border border-divider">
          <div className="flex justify-between bg-bg px-3.5 py-2.5 text-[11px] font-bold tracking-wider text-text/60 uppercase">
            <span>Items</span>
            <span>Avg price</span>
          </div>
          {recipe.items.map((item) => (
            <div key={item.itemId} className="flex items-center gap-2.5 border-t border-divider px-3.5 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{item.itemName}</span>
                {item.amount && <span className="text-text/60"> · {item.amount}</span>}
              </span>
              <span className="tag tag-neutral hidden sm:inline-flex">{item.categoryName}</span>
              <span className="w-16 text-right font-bold tabular-nums">{item.averagePrice != null ? `${money(item.averagePrice)}${perUnit(item.priceUnit)}` : <span className="font-normal text-text/40">—</span>}</span>
            </div>
          ))}
        </div>

        {hasPhoto && (
          <div>
            <button type="button" className="btn btn-ghost btn-sm text-text/70" disabled={!online || removePhoto.isPending} onClick={() => removePhoto.mutate()}>
              Remove photo
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-divider pt-4">
          <div className="min-w-0 flex-1 basis-40 text-[13px] text-text/70">
            {recipe.estimatedCost != null ? (
              <>
                Estimated <strong className="font-heading text-lg text-text">{money(recipe.estimatedCost)}</strong> from household averages
                {recipe.items.some((i) => i.priceUnit === 'lb' && i.averagePrice != null) && ', counting 1 lb of anything sold by weight'}
              </>
            ) : (
              'No prices yet — items get them once they are bought.'
            )}
          </div>
          <Link to={`/trips/new?recipe=${recipe.id}`} className="btn btn-highlight min-h-12 px-5 text-[15px] max-sm:w-full">
            <RecipeIcon>{BAG}</RecipeIcon>Create shopping list
          </Link>
        </div>
      </div>

      {exporting && (
        <div aria-hidden="true" style={{ position: 'fixed', left: -10000, top: 0 }}>
          <RecipeShareCard ref={exportRef} recipe={recipe} />
        </div>
      )}
    </Dialog>
  )
}

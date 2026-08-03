import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { Dialog } from '../components/ui/Dialog'
import { useToast } from '../components/ui/ToastProvider'

export function SettingsDialog() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [newCategoryName, setNewCategoryName] = useState('')

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.settings.get })
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: api.categories.list })

  const close = () => navigate(-1)

  const setTheme = useMutation({
    mutationFn: (themeMode: 'system' | 'light' | 'dark') => api.settings.update({ themeMode }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  const addCategory = useMutation({
    mutationFn: (name: string) => api.categories.create(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      setNewCategoryName('')
    },
    onError: () => toast('error', 'That category already exists.'),
  })

  const removeCategory = useMutation({
    mutationFn: (id: string) => api.categories.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categories'] }),
    onError: () => toast('error', "Couldn't remove that category."),
  })

  const themeMode = settings?.themeMode ?? 'system'

  return (
    <Dialog title="Settings" onClose={close}>
      <div className="field">
        <label>Appearance</label>
        <div className="seg" role="radiogroup">
          {(['system', 'light', 'dark'] as const).map((mode) => (
            <label key={mode} className="seg-opt">
              <input type="radio" name="theme" checked={themeMode === mode} onChange={() => setTheme.mutate(mode)} />
              {mode[0].toUpperCase() + mode.slice(1)}
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <label>Categories</label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {categories?.map((c) => (
            <span key={c.id} className="tag tag-neutral flex items-center gap-1.5">
              {c.name}
              {!c.isBuiltIn && (
                <button
                  type="button"
                  className="cursor-pointer border-none bg-transparent p-0 text-xs"
                  onClick={() => removeCategory.mutate(c.id)}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input
            className="input"
            placeholder="Add a category"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && newCategoryName.trim() && addCategory.mutate(newCategoryName.trim())}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!newCategoryName.trim()}
            onClick={() => addCategory.mutate(newCategoryName.trim())}
          >
            Add
          </button>
        </div>
      </div>

      <div className="field">
        <label>Backup</label>
        <a href="/api/v1/export/data.xlsx" download className="btn btn-primary btn-block">
          Download my data (.xlsx)
        </a>
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={close}>
          Close
        </button>
      </div>
    </Dialog>
  )
}

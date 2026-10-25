import { useRef, useState, type ReactNode } from 'react'
import { useToast } from '../ui/ToastProvider'
import { CANVAS_BLOCKED, canvasExportWorks, inspectPhoto } from '../../recipes'
import { PhotoCropper } from './PhotoCropper'

// Choosing a recipe photo: a file that already fits the limits goes straight to `onPhoto`;
// a larger one opens the crop editor first, and only its cropped result is passed on.
// Render `ui` once in the component (it holds the hidden file input and the editor).
export function usePhotoPicker(onPhoto: (photo: Blob) => void): { choose: () => void; ui: ReactNode } {
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [cropping, setCropping] = useState<{ file: File; reason: string } | null>(null)

  const picked = async (file: File | undefined) => {
    if (input.current) input.current.value = '' // picking the same file again must still fire
    if (!file) return
    try {
      const info = await inspectPhoto(file)
      if (!info.tooLarge) onPhoto(file)
      // Cropping draws on a canvas; where the browser fakes that, the "crop" would be noise.
      else if (!canvasExportWorks()) toast('error', `${info.tooLarge} ${CANVAS_BLOCKED}, so it can't be cropped here — choose a photo within the limits, or use another browser.`)
      else setCropping({ file, reason: info.tooLarge })
    } catch {
      toast('error', "That file couldn't be read as a picture. Try a JPEG or PNG.")
    }
  }

  return {
    choose: () => input.current?.click(),
    ui: (
      <>
        <input
          ref={input}
          type="file"
          accept="image/*"
          aria-label="Recipe photo"
          className="hidden"
          onChange={(e) => void picked(e.target.files?.[0])}
        />
        {cropping && (
          <PhotoCropper
            file={cropping.file}
            reason={cropping.reason}
            onCancel={() => setCropping(null)}
            onCropped={(photo) => {
              setCropping(null)
              onPhoto(photo)
            }}
          />
        )}
      </>
    ),
  }
}

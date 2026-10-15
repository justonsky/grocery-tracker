import { useId, useMemo, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'

export interface ComboOption {
  value: string // what selecting it puts in the field (or the id, for pickers)
  label: string // what's matched against and shown
  hint?: string // secondary text on the right, e.g. a price
}

const normalize = (s: string) => s.trim().toLowerCase()

// Best matches first: names starting with the query, then a word starting with
// it, then containing it anywhere; alphabetical within each tier.
export function rankOptions(options: ComboOption[], query: string): ComboOption[] {
  const q = normalize(query)
  if (!q) return options
  const tiers: ComboOption[][] = [[], [], []]
  for (const option of options) {
    const label = normalize(option.label)
    if (label.startsWith(q)) tiers[0].push(option)
    else if (label.split(/[\s\-/(]+/).some((word) => word.startsWith(q))) tiers[1].push(option)
    else if (label.includes(q)) tiers[2].push(option)
  }
  const byLabel = (a: ComboOption, b: ComboOption) => a.label.localeCompare(b.label)
  return [...tiers[0].sort(byLabel), ...tiers[1].sort(byLabel), ...tiers[2].sort(byLabel)]
}

function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const q = normalize(query)
  const at = q ? text.toLowerCase().indexOf(q) : -1
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <strong className="font-semibold">{text.slice(at, at + q.length)}</strong>
      {text.slice(at + q.length)}
    </>
  )
}

interface ComboboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'onSelect' | 'value'> {
  value: string
  onChange: (text: string) => void
  options: ComboOption[]
  onSelect?: (option: ComboOption) => void
  // At most this many suggestions are listed; the rest are a "keep typing" away.
  maxResults?: number
  // 0 opens the list on focus with the first options (e.g. recent trips).
  minChars?: number
  // Classes for the positioning wrapper (e.g. grid placement); className styles the input.
  wrapperClassName?: string
}

// A text field with a short, ranked suggestion list — instead of a native
// <datalist>, which can't be capped and would list every item in the household.
// Follows the ARIA 1.2 combobox pattern: arrow keys move, Enter picks, Escape
// closes; rows are 44px tall so they're easy to hit on a phone.
export function Combobox({
  value,
  onChange,
  options,
  onSelect,
  maxResults = 8,
  minChars = 1,
  onKeyDown,
  onFocus,
  onBlur,
  className = '',
  wrapperClassName = '',
  ...inputProps
}: ComboboxProps) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const ranked = useMemo(() => rankOptions(options, value), [options, value])
  const shown = ranked.slice(0, maxResults)
  const hidden = ranked.length - shown.length
  // Nothing to suggest once the field already holds exactly the only match.
  const exactOnly = shown.length === 1 && normalize(shown[0].label) === normalize(value)
  const expanded = open && value.trim().length >= minChars && shown.length > 0 && !exactOnly

  const pick = (option: ComboOption) => {
    if (onSelect) onSelect(option)
    else onChange(option.value)
    setOpen(false)
    setActive(-1)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      if (shown.length === 0) return
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % shown.length : i <= 0 ? shown.length - 1 : i - 1))
      return
    }
    if (e.key === 'Enter' && expanded && active >= 0) {
      e.preventDefault()
      pick(shown[active])
      return
    }
    if (e.key === 'Escape' && expanded) {
      e.preventDefault()
      setOpen(false)
      return
    }
    onKeyDown?.(e)
  }

  return (
    <div className={`relative min-w-0 ${wrapperClassName}`}>
      <input
        {...inputProps}
        ref={inputRef}
        className={`input ${className}`}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={(e) => {
          setOpen(true)
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setOpen(false)
          setActive(-1)
          onBlur?.(e)
        }}
        onKeyDown={handleKeyDown}
      />
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 m-0 mt-1 max-h-[min(22rem,50dvh)] min-w-[12rem] list-none overflow-y-auto rounded-md bg-surface p-1"
          style={{ boxShadow: 'var(--shadow-lg)' }}
        >
          {shown.map((option, i) => (
            <li
              key={`${option.value}-${i}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: keeps focus in the field so blur doesn't close the list first.
              onMouseDown={(e) => {
                e.preventDefault()
                pick(option)
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded px-2.5 text-sm text-text ${
                i === active ? 'bg-accent/12' : ''
              }`}
            >
              <span className="min-w-0 truncate">
                <Highlight text={option.label} query={value} />
              </span>
              {option.hint && <span className="shrink-0 text-xs text-text/55">{option.hint}</span>}
            </li>
          ))}
          {hidden > 0 && (
            <li role="presentation" className="px-2.5 py-1.5 text-xs text-text/50">
              {hidden} more — keep typing to narrow it down
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

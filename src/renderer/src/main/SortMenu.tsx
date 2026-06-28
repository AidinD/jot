import { useEffect, useRef, useState } from 'react'

interface SortOption<T extends string> {
  value: T
  label: string
}

interface SortMenuProps<T extends string> {
  value: T
  options: SortOption<T>[]
  onChange: (value: T) => void
}

/**
 * Lightweight custom dropdown used instead of a native <select>. The native
 * popup was sluggish to open in Electron and rendered with the OS theme; this
 * opens instantly (just toggles state) and is fully styleable for dark mode.
 */
export function SortMenu<T extends string>({
  value,
  options,
  onChange
}: SortMenuProps<T>): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    function handlePointerDown(event: MouseEvent): void {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const current = options.find((opt) => opt.value === value)

  return (
    <div className="sort-menu" ref={ref}>
      <button type="button" className="sort-trigger" onClick={() => setOpen((v) => !v)}>
        {current?.label ?? value}
        <span className="sort-caret">▾</span>
      </button>
      {open ? (
        <ul className="sort-options" role="listbox">
          {options.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={`sort-option${opt.value === value ? ' active' : ''}`}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'

export function Capture(): JSX.Element {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    // The main process fires this whenever the popover is re-opened, so the
    // field is empty and focused every time the hotkey is pressed.
    const unsubscribe = window.capture.onReset(() => {
      setText('')
      inputRef.current?.focus()
    })
    return () => {
      unsubscribe()
    }
  }, [])

  async function submit(): Promise<void> {
    const value = text.trim()
    if (value.length === 0) {
      window.capture.close()
      return
    }
    await window.capture.submit(value)
    setText('')
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      window.capture.close()
    }
  }

  return (
    <div className="capture">
      <input
        ref={inputRef}
        className="capture-input"
        placeholder="What do you need to remember?"
        value={text}
        onChange={(event) => {
          setText(event.target.value)
        }}
        onKeyDown={handleKeyDown}
      />
      <div className="capture-hint">
        <span>Enter to save</span>
        <span>Esc to dismiss</span>
      </div>
    </div>
  )
}

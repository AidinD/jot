import { useEffect, useMemo, useRef, useState } from 'react'
import type { Category } from '@shared/types'

const MAX_SUGGESTIONS = 6

// "#token" at the very end of the input (token = no spaces, no further #).
const TRAILING_HASHTAG = /#([^\s#]*)\s*$/

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

function stripTrailingHashtag(text: string): string {
  return text.replace(TRAILING_HASHTAG, '').trim()
}

export function Capture(): JSX.Element {
  const [text, setText] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()

    window.jot.getState().then((state) => {
      setCategories(state.categories)
    })
    const unsubscribeState = window.jot.onChanged((state) => {
      setCategories(state.categories)
    })

    // Fired by the main process each time the popover re-opens.
    const unsubscribeReset = window.capture.onReset(() => {
      setText('')
      setActiveIndex(0)
      inputRef.current?.focus()
    })

    return () => {
      unsubscribeState()
      unsubscribeReset()
    }
  }, [])

  // Active #partial being typed at the end of the input, if any.
  const partial = useMemo(() => {
    const match = text.match(TRAILING_HASHTAG)
    if (match === null) {
      return null
    }
    return match[1]
  }, [text])

  const suggestions = useMemo(() => {
    if (partial === null) {
      return []
    }
    const needle = normalize(partial)
    return categories
      .filter((category) => {
        return needle.length === 0 || normalize(category.name).includes(needle)
      })
      .slice(0, MAX_SUGGESTIONS)
  }, [partial, categories])

  function submitWith(value: string, categoryId: string | null): void {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      window.capture.close()
      return
    }
    window.capture.submit(trimmed, categoryId)
    setText('')
    setActiveIndex(0)
  }

  function acceptSuggestion(category: Category): void {
    submitWith(stripTrailingHashtag(text), category.id)
  }

  /**
   * Submit when no suggestion is chosen. A trailing #token files into a
   * matching list; if none matches, the list is created on the fly and the
   * todo is filed into it. No token → uncategorized.
   */
  async function submitFromText(): Promise<void> {
    const match = text.match(TRAILING_HASHTAG)
    if (match === null || match[1].length === 0) {
      submitWith(text, null)
      return
    }
    const rawName = match[1]
    const stripped = stripTrailingHashtag(text)
    if (stripped.length === 0) {
      window.capture.close()
      return
    }
    const existing = categories.find((candidate) => {
      return normalize(candidate.name) === normalize(rawName)
    })
    if (existing !== undefined) {
      submitWith(stripped, existing.id)
      return
    }
    const newCategoryId = await window.jot.addCategory(rawName)
    submitWith(stripped, newCategoryId)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      window.capture.close()
      return
    }

    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveIndex((index) => {
          return (index + 1) % suggestions.length
        })
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((index) => {
          return (index - 1 + suggestions.length) % suggestions.length
        })
        return
      }
      if (event.key === 'Tab') {
        // Complete the token in place without submitting, so the user can edit.
        event.preventDefault()
        const chosen = suggestions[activeIndex]
        if (chosen !== undefined) {
          setText(`${stripTrailingHashtag(text)} #${normalize(chosen.name)} `.replace(/^\s+/, ''))
        }
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const chosen = suggestions[activeIndex]
        if (chosen !== undefined) {
          acceptSuggestion(chosen)
        }
        return
      }
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      submitFromText()
    }
  }

  return (
    <div className="capture">
      <input
        ref={inputRef}
        className="capture-input"
        placeholder="What do you need to remember?  (#list to file it)"
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          setActiveIndex(0)
        }}
        onKeyDown={handleKeyDown}
      />

      {suggestions.length > 0 ? (
        <div className="capture-suggestions">
          {suggestions.map((category, index) => {
            const className = index === activeIndex ? 'suggestion active' : 'suggestion'
            return (
              <button
                key={category.id}
                className={className}
                onMouseDown={(event) => {
                  // Keep input focus; act on click.
                  event.preventDefault()
                  acceptSuggestion(category)
                }}
              >
                <span className="cat-dot" style={{ background: category.color }} />
                {category.name}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="capture-hint">
          <span>Enter to save</span>
          <span>#list to file or create · Esc to dismiss</span>
        </div>
      )}
    </div>
  )
}

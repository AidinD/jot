import { jotApi } from '../jotApiClient'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Category } from '@shared/types'
import { normalize, stripTrailingHashtag, TRAILING_HASHTAG } from '@shared/hashtag'
import { parsePriority } from '@shared/priority'
import { completeAtToken, dateSuggestions, parseDeadline, TRAILING_AT } from '@shared/deadline'
import { DateSuggestions } from '@shared/DateSuggestions'
import type { DateSuggestionsHandle } from '@shared/DateSuggestions'

const MAX_SUGGESTIONS = 6

const LAST_CAT_KEY = 'jot:lastCategoryId'

export function Capture(): JSX.Element {
  const [text, setText] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [dateIndex, setDateIndex] = useState(0)
  const [lastCategoryId, setLastCategoryId] = useState<string | null>(() => {
    return localStorage.getItem(LAST_CAT_KEY)
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const dateSuggestionsRef = useRef<DateSuggestionsHandle>(null)

  useEffect(() => {
    inputRef.current?.focus()

    jotApi().getState().then((state) => {
      setCategories(state.categories)
    })
    const unsubscribeState = jotApi().onChanged((state) => {
      setCategories(state.categories)
    })

    // Fired by the main process each time the popover re-opens.
    const unsubscribeReset = window.capture.onReset(() => {
      setText('')
      setActiveIndex(0)
      setDateIndex(0)
      inputRef.current?.focus()
    })

    return () => {
      unsubscribeState()
      unsubscribeReset()
    }
  }, [])

  // If the referenced category was deleted, drop the stored preference.
  useEffect(() => {
    if (lastCategoryId !== null && categories.length > 0) {
      const exists = categories.some((c) => c.id === lastCategoryId)
      if (!exists) {
        localStorage.removeItem(LAST_CAT_KEY)
        setLastCategoryId(null)
      }
    }
  }, [categories, lastCategoryId])

  const lastCategory = useMemo(() => {
    if (lastCategoryId === null) {
      return null
    }
    return categories.find((c) => c.id === lastCategoryId) ?? null
  }, [lastCategoryId, categories])

  function persistLastCategory(categoryId: string | null): void {
    if (categoryId !== null) {
      localStorage.setItem(LAST_CAT_KEY, categoryId)
      setLastCategoryId(categoryId)
    }
  }

  function clearLastCategory(): void {
    localStorage.removeItem(LAST_CAT_KEY)
    setLastCategoryId(null)
  }

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

  // Active `@partial` being typed at the end of the input, if any. Drives the
  // date-picker dropdown the same way `partial` drives the category dropdown.
  const atPartial = useMemo(() => {
    const match = text.match(TRAILING_AT)
    return match !== null ? match[2] : null
  }, [text])

  const dateSugs = useMemo(() => {
    return atPartial === null ? [] : dateSuggestions(atPartial)
  }, [atPartial])

  function submitWith(value: string, categoryId: string | null): void {
    const { priority, text: withoutPriority } = parsePriority(value)
    const { deadline, text: withoutDeadline } = parseDeadline(withoutPriority)
    const trimmed = withoutDeadline.trim()
    if (trimmed.length === 0) {
      window.capture.close()
      return
    }
    window.capture.submit(trimmed, categoryId, priority ?? undefined, deadline ?? undefined)
    persistLastCategory(categoryId)
    setText('')
    setActiveIndex(0)
  }

  function acceptSuggestion(category: Category): void {
    submitWith(stripTrailingHashtag(text), category.id)
  }

  function pickDate(token: string): void {
    setText(completeAtToken(text, token))
    setDateIndex(0)
    inputRef.current?.focus()
  }

  /**
   * Submit when no suggestion is chosen. A trailing #token files into a
   * matching list; if none matches, the list is created on the fly and the
   * todo is filed into it. No token → uncategorized.
   */
  async function submitFromText(): Promise<void> {
    const match = text.match(TRAILING_HASHTAG)
    if (match === null || match[1].length === 0) {
      // No #tag typed — fall back to the last-used category if one is pinned.
      submitWith(text, lastCategoryId)
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
    const newCategoryId = await jotApi().addCategory(rawName)
    submitWith(stripped, newCategoryId)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      window.capture.close()
      return
    }

    // Backspace on empty input clears the pinned last-category chip.
    if (event.key === 'Backspace' && text === '' && lastCategoryId !== null) {
      event.preventDefault()
      clearLastCategory()
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

    // Date dropdown navigation (trailing `@token`). The last index past the
    // suggestions is the "Pick a date…" calendar row.
    if (atPartial !== null) {
      const navLength = dateSugs.length + 1
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setDateIndex((index) => (index + 1) % navLength)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setDateIndex((index) => (index - 1 + navLength) % navLength)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const chosen = dateSugs[dateIndex]
        if (chosen !== undefined) {
          pickDate(chosen.token)
        } else {
          dateSuggestionsRef.current?.openCalendar()
        }
        return
      }
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      // Empty input + Enter opens the full Jot window instead of doing nothing.
      if (text.trim() === '') {
        window.capture.openMain()
        return
      }
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
          setDateIndex(0)
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
      ) : atPartial !== null ? (
        <DateSuggestions
          ref={dateSuggestionsRef}
          className="capture-suggestions"
          suggestions={dateSugs}
          activeIndex={dateIndex}
          onPick={(suggestion) => pickDate(suggestion.token)}
          onCalendarPick={(iso) => pickDate(iso)}
        />
      ) : lastCategory !== null ? (
        <div className="capture-hint">
          <div className="last-cat-chip">
            <span className="cat-dot" style={{ background: lastCategory.color }} />
            <span className="last-cat-chip-name">{lastCategory.name}</span>
            <button
              className="last-cat-chip-remove"
              onMouseDown={(event) => {
                event.preventDefault()
                clearLastCategory()
                inputRef.current?.focus()
              }}
            >
              ×
            </button>
          </div>
          <span>Backspace to clear</span>
        </div>
      ) : (
        <div className="capture-hint">
          <span>{text.trim() === '' ? 'Enter to open Jot' : 'Enter to save'}</span>
          <span>#list · @date · Esc to dismiss</span>
        </div>
      )}
    </div>
  )
}

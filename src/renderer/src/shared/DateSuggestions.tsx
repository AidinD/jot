import { forwardRef, useImperativeHandle, useRef } from 'react'
import type { DateSuggestion } from './deadline'

export interface DateSuggestionsHandle {
  /** Opens the native calendar picker for an arbitrary date. */
  openCalendar: () => void
}

interface DateSuggestionsProps {
  className: string
  suggestions: DateSuggestion[]
  /** 0..suggestions.length — the last index is the "Pick a date…" calendar row. */
  activeIndex: number
  onPick: (suggestion: DateSuggestion) => void
  /** Called with an ISO `YYYY-MM-DD` string once a calendar date is chosen. */
  onCalendarPick: (iso: string) => void
}

/**
 * The `@` date dropdown: quick day suggestions plus a "Pick a date…" row that
 * opens the OS calendar for any date. Mirrors the category (`#`) dropdown so
 * the two feel identical. The calendar `<input>` is kept off-screen and driven
 * imperatively — clicking the row (or Enter on it) calls showPicker().
 */
export const DateSuggestions = forwardRef<DateSuggestionsHandle, DateSuggestionsProps>(
  function DateSuggestions({ className, suggestions, activeIndex, onPick, onCalendarPick }, ref) {
    const dateInputRef = useRef<HTMLInputElement>(null)

    function openCalendar(): void {
      try {
        dateInputRef.current?.showPicker()
      } catch {
        // showPicker throws without a user gesture; the row click is one, so
        // this only guards odd cases. Silently ignore.
      }
    }

    useImperativeHandle(ref, () => ({ openCalendar }), [])

    const calendarIndex = suggestions.length

    return (
      <div className={`${className} date-suggestions`}>
        {suggestions.map((suggestion, index) => {
          const cls = index === activeIndex ? 'suggestion active' : 'suggestion'
          return (
            <button
              key={suggestion.token}
              className={cls}
              onMouseDown={(event) => {
                event.preventDefault()
                onPick(suggestion)
              }}
            >
              <span className="date-sug-label">{suggestion.label}</span>
              <span className="date-sug-sub">{suggestion.sublabel}</span>
            </button>
          )
        })}
        <button
          className={activeIndex === calendarIndex ? 'suggestion active' : 'suggestion'}
          onMouseDown={(event) => {
            event.preventDefault()
            openCalendar()
          }}
        >
          <span className="date-sug-label">📅 Pick a date…</span>
        </button>
        <input
          ref={dateInputRef}
          type="date"
          className="date-suggestions-hidden-input"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const value = event.target.value
            if (value !== '') {
              onCalendarPick(value)
            }
            event.target.value = ''
          }}
        />
      </div>
    )
  }
)

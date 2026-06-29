// Matches a priority token like "!2" or "!-1" anywhere in the text. Any whole
// number works; lower sorts higher (so "!-1" sits above the default 0).
const PRIORITY_TOKEN = /(^|\s)!(-?\d+)(?=\s|$)/

/**
 * Pulls a `!N` priority token out of the entered text. Returns the parsed
 * priority (null when none was typed — the caller defaults to 0) and the text
 * with the token removed.
 */
export function parsePriority(text: string): { priority: number | null; text: string } {
  const match = text.match(PRIORITY_TOKEN)
  if (match === null) {
    return { priority: null, text }
  }
  const priority = parseInt(match[2], 10)
  const stripped = text
    .replace(PRIORITY_TOKEN, (_full, lead: string) => (lead === '' ? '' : ' '))
    .replace(/\s{2,}/g, ' ')
    .trim()
  return { priority, text: stripped }
}

/** Display label for a priority group divider/badge. 0 means "no priority". */
export function priorityLabel(priority: number): string {
  if (priority === 0) {
    return 'No priority'
  }
  return `P${priority}`
}

// Matches an `@token` anywhere in the text: an ISO date (@2026-07-05), a
// relative day (@today/@idag, @tomorrow/@imorgon), or a weekday name (English
// or Swedish, short or long — @fri, @fredag). Unknown tokens are left alone so
// a stray `@mention` doesn't get silently eaten.
const DEADLINE_TOKEN = /(^|\s)@(\S+)(?=\s|$)/i

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, sön: 0, söndag: 0,
  mon: 1, monday: 1, mån: 1, måndag: 1,
  tue: 2, tuesday: 2, tis: 2, tisdag: 2,
  wed: 3, wednesday: 3, ons: 3, onsdag: 3,
  thu: 4, thursday: 4, tor: 4, torsdag: 4,
  fri: 5, friday: 5, fre: 5, fredag: 5,
  sat: 6, saturday: 6, lör: 6, lördag: 6
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function resolveToken(token: string): number | null {
  const isoMatch = token.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch !== null) {
    const [, y, m, d] = isoMatch
    return startOfDay(new Date(Number(y), Number(m) - 1, Number(d)))
  }

  const today = new Date()
  const lower = token.toLowerCase()
  if (lower === 'today' || lower === 'idag') {
    return startOfDay(today)
  }
  if (lower === 'tomorrow' || lower === 'imorgon' || lower === 'imorron') {
    return startOfDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1))
  }
  const weekday = WEEKDAYS[lower]
  if (weekday !== undefined) {
    // Next occurrence of that weekday, not counting today.
    let delta = weekday - today.getDay()
    if (delta <= 0) {
      delta += 7
    }
    return startOfDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + delta))
  }
  return null
}

/**
 * Pulls an `@token` deadline out of the entered text. Returns null (and the
 * text unchanged) when there is no token or it doesn't resolve to a date.
 */
export function parseDeadline(text: string): { deadline: number | null; text: string } {
  const match = text.match(DEADLINE_TOKEN)
  if (match === null) {
    return { deadline: null, text }
  }
  const deadline = resolveToken(match[2])
  if (deadline === null) {
    return { deadline: null, text }
  }
  const stripped = text
    .replace(DEADLINE_TOKEN, (_full, lead: string) => (lead === '' ? '' : ' '))
    .replace(/\s{2,}/g, ' ')
    .trim()
  return { deadline, text: stripped }
}

/** Short display label, e.g. "Jul 5". */
export function formatDeadline(deadline: number): string {
  return new Date(deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function isOverdue(deadline: number): boolean {
  return deadline < startOfDay(new Date())
}

export function isDueToday(deadline: number): boolean {
  return deadline === startOfDay(new Date())
}

/** For binding to an `<input type="date">`. */
export function toDateInputValue(deadline: number | null): string {
  if (deadline === null) {
    return ''
  }
  const d = new Date(deadline)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromDateInputValue(value: string): number | null {
  const parts = value.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return null
  }
  const [y, m, d] = parts
  return new Date(y, m - 1, d).getTime()
}

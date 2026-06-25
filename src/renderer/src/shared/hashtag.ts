export const TRAILING_HASHTAG = /#([^\s#]*)\s*$/

export function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '')
}

export function stripTrailingHashtag(text: string): string {
  return text.replace(TRAILING_HASHTAG, '').trim()
}

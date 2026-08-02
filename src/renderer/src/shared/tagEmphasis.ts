import type { Tag } from './types'

/**
 * The one rule for whether a todo is drawn with an emphasis stripe, and in which
 * colour. Both the list row and the board card call this, so the two views can
 * never disagree about which of a todo's tags wins.
 *
 * A todo can carry several emphasised tags. The winner is the FIRST one in the
 * board's own tag order, not in the todo's - the todo's array is insertion
 * order, so an identical pair of tags applied in a different sequence would
 * otherwise stripe two cards differently and the colour would stop meaning
 * anything. The board's order is the same for every card. (Pass the tagsById
 * Map's values: a Map keeps insertion order, and it is built from state.tags.)
 *
 * Returns null when nothing on this todo asks for emphasis, which is the
 * overwhelmingly common case.
 */
export function emphasisFor(tagIds: string[], orderedTags: Iterable<Tag>): Tag | null {
  if (tagIds.length === 0) {
    return null
  }
  const carried = new Set(tagIds)
  for (const tag of orderedTags) {
    if (tag.emphasis === 'stripe' && carried.has(tag.id)) {
      return tag
    }
  }
  return null
}

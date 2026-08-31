/**
 * The reference for a todo, to paste into a conversation.
 *
 * The todo's own id, with its text beside it. The id is what makes it findable —
 * it is the key every external agent already addresses the card by in
 * `todos.json` (see INTEGRATION.md) — and the text is there so the person
 * pasting can see they copied the right card.
 *
 * Deliberately NOT a new short number. A second identifier for the same todo is
 * a second thing that can drift out of step with the first, which is the same
 * reason a list carries `repoPath` instead of being matched by its name.
 *
 * Same shape as Nib's `nib:<id> "Title"`, so a reference to a note and a
 * reference to a card read alike and neither has to be explained twice.
 */
export function todoReference(id: string, text: string): string {
  const name = text.trim().length > 0 ? text.trim() : 'Untitled'
  return `jot:${id} "${name}"`
}

export interface Point {
  left: number
  top: number
}

/**
 * Pull a popover back inside the window when it would hang off an edge.
 *
 * Takes the measured size rather than a guessed width: the menu is as wide as
 * the longest thing in it, and a todo's id is a uuid while its text is whatever
 * was typed. Right-clicking a card at the bottom of a full column is the normal
 * case here, not the awkward one.
 */
export function clampToViewport(
  at: Point,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 6
): Point {
  return {
    left: Math.max(margin, Math.min(at.left, viewport.width - size.width - margin)),
    top: Math.max(margin, Math.min(at.top, viewport.height - size.height - margin))
  }
}

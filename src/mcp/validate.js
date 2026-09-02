/**
 * What this surface refuses, and why refusing is the feature.
 *
 * The assistant seat this server exists for runs under a guard that denies every
 * file-writing tool and exempts MCP tools (Helm's DECISIONS.md, "An assistant seat
 * is not a first mate with a different manual"). The alternative considered there
 * was a path-aware guard, and it was rejected for one reason: a guard that allows
 * any write inside a folder allows an INVALID write inside that folder. A todo
 * filed under a category id that does not exist is invisible in every view of the
 * app; a status the app does not know collapses to "open" on next load, silently
 * undoing the move somebody asked for. Neither of those is a crash, which is what
 * makes them expensive.
 *
 * So every check here exists to turn a corrupt write into a message an agent can
 * act on. Each one names what was wrong AND what would have been right, because a
 * caller that gets "unknown category, the lists are A, B, C" corrects itself and
 * one that gets "invalid argument" asks the user.
 *
 * Kept in its own file so a check can be broken on purpose and the test suite
 * watched to fail. A validation nobody has seen fail is not evidence.
 */

/**
 * The statuses Jot actually has.
 *
 * Not a judgement call: this is the `TodoStatus` union in `src/core/types.ts`, and
 * the same four strings `normalizeTodo` in `src/core/storage.ts` will accept from
 * a file. Anything else that reaches the file is rewritten to "open" the next time
 * the app loads it. `scripts/test-mcp-tools.mjs` reads the union out of the
 * TypeScript source and fails if these two lists ever drift apart.
 */
export const STATUSES = ['open', 'in-progress', 'review', 'done']

/**
 * Trimmed text, or a refusal.
 *
 * The app's own `addTodo` returns silently when the text is empty, which is right
 * for a keystroke and wrong here: an agent that gets no error believes the card
 * exists and moves on, and nobody finds out until the board is read back.
 *
 * @param {unknown} text
 * @returns {{ value: string } | { error: string }}
 */
export function checkText(text) {
  if (typeof text !== 'string') {
    return { error: `A task needs text, and text must be a string (got ${typeName(text)}).` }
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { error: 'A task needs text. An empty title makes a card nobody can identify.' }
  }
  return { value: trimmed }
}

/**
 * @param {unknown} status
 * @returns {{ value: string } | { error: string }}
 */
export function checkStatus(status) {
  if (typeof status === 'string' && STATUSES.includes(status)) {
    return { value: status }
  }
  return {
    error:
      `Unknown status ${quote(status)}. Jot's statuses are: ${STATUSES.join(', ')}. ` +
      `Anything else is rewritten to "open" when the app next loads the file, which ` +
      `would undo this move without saying so.`
  }
}

/**
 * A whole number, or a refusal.
 *
 * Integers only. The app truncates a fraction on load, so 2.5 would land as 2 -
 * a different priority from the one asked for, written without complaint.
 *
 * @param {unknown} priority
 * @returns {{ value: number } | { error: string }}
 */
export function checkPriority(priority) {
  if (typeof priority !== 'number' || !Number.isFinite(priority)) {
    return {
      error:
        `Priority must be a number (got ${typeName(priority)}). Lower is more urgent: ` +
        `-1 sits above 0, and 0 means "no priority".`
    }
  }
  if (!Number.isInteger(priority)) {
    return {
      error:
        `Priority must be a whole number (got ${priority}). Jot truncates a fraction on ` +
        `load, so this would quietly become ${Math.trunc(priority)}.`
    }
  }
  return { value: priority }
}

/**
 * A deadline in milliseconds, or a refusal.
 *
 * `null` and an omitted value both mean "no deadline", which is the normal case.
 *
 * The lower bound is not pedantry. Every other timestamp API in the world takes
 * seconds, so a caller reaching for `Date.now() / 1000` is the likely mistake, and
 * 1.7e9 milliseconds is January 1970 - a card that arrives permanently overdue,
 * with a date nobody typed. Refusing it names the unit; writing it looks like a
 * bug in the app.
 *
 * @param {unknown} deadline
 * @returns {{ value: number | null } | { error: string }}
 */
export function checkDeadline(deadline) {
  if (deadline === undefined || deadline === null) {
    return { value: null }
  }
  if (typeof deadline !== 'number' || !Number.isFinite(deadline)) {
    return {
      error: `A deadline must be milliseconds since the epoch, or null (got ${typeName(deadline)}).`
    }
  }
  const YEAR_2001 = 978307200000
  if (deadline < YEAR_2001) {
    return {
      error:
        `${deadline} is before 2001 when read as milliseconds, which is what Jot stores. ` +
        `If that came from a seconds-based timestamp, multiply it by 1000.`
    }
  }
  return { value: deadline }
}

/**
 * Resolve a category argument to a real list on the board.
 *
 * Takes an id, or - as a convenience for a caller that has a name and not a uuid -
 * a category's exact name, case-insensitively. Exact only: a partial match is how
 * a task ends up filed on the wrong list, and a task on the wrong list is worse
 * than a refusal because nobody goes looking for it.
 *
 * `null`/`undefined` resolves to "no list", which is a real state in Jot (the card
 * shows under All and nowhere else).
 *
 * @param {import("./board.js").Board} board
 * @param {unknown} categoryId
 * @returns {{ value: any | null } | { error: string }}
 */
export function checkCategory(board, categoryId) {
  if (categoryId === undefined || categoryId === null) {
    return { value: null }
  }
  if (typeof categoryId !== 'string' || categoryId.trim().length === 0) {
    return { error: `A category id must be a non-empty string (got ${typeName(categoryId)}).` }
  }

  const wanted = categoryId.trim()
  const byId = board.categories.find((category) => category.id === wanted)
  if (byId !== undefined) {
    return { value: byId }
  }

  const lowered = wanted.toLowerCase()
  const byName = board.categories.filter((category) => {
    return typeof category.name === 'string' && category.name.trim().toLowerCase() === lowered
  })
  if (byName.length === 1) {
    return { value: byName[0] }
  }
  if (byName.length > 1) {
    return {
      error:
        `${quote(wanted)} is the name of ${byName.length} lists, so it does not say which ` +
        `one. Use an id: ${byName.map((category) => category.id).join(', ')}.`
    }
  }

  if (board.categories.length === 0) {
    return { error: `Unknown category ${quote(wanted)}. This board has no lists at all yet.` }
  }
  return {
    error:
      `Unknown category ${quote(wanted)}. Jot's lists are: ${board.categories
        .map((category) => `${category.name} (${category.id})`)
        .join(', ')}.`
  }
}

/**
 * Find the todo a write is aimed at.
 *
 * A missing id is the refusal that matters most in practice, because it is what a
 * stale id looks like: a card the user deleted, or one an agent invented from a
 * half-remembered conversation. Writing it back would recreate nothing and change
 * nothing, and report success either way.
 *
 * @param {import("./board.js").Board} board
 * @param {unknown} id
 * @param {string} [label]
 * @returns {{ value: any } | { error: string }}
 */
export function checkTodo(board, id, label = 'id') {
  if (typeof id !== 'string' || id.trim().length === 0) {
    return { error: `A task ${label} must be a non-empty string (got ${typeName(id)}).` }
  }
  const todo = board.todos.find((candidate) => candidate.id === id.trim())
  if (todo === undefined) {
    return {
      error:
        `No task on the board has ${label} ${quote(id)}. It may have been deleted, or ` +
        `completed and archived - list the board again rather than trusting an id from ` +
        `earlier in a conversation.`
    }
  }
  return { value: todo }
}

/**
 * Find the parent a subtask is being hung under.
 *
 * Also refuses a parent that is itself a subtask. Nesting in Jot is one level deep
 * (`src/core/types.ts`), and the app's own store leaves that to whoever calls it -
 * the UI only offers the action on root cards. On this surface there is no UI to
 * lean on, so the invariant has to be checked here or not at all. A two-deep
 * subtask does not crash anything; it just never appears, because every view
 * renders subtasks one level under a root card.
 *
 * @param {import("./board.js").Board} board
 * @param {unknown} parentId
 * @returns {{ value: any } | { error: string }}
 */
export function checkParent(board, parentId) {
  const found = checkTodo(board, parentId, 'parentId')
  if ('error' in found) {
    return found
  }
  const parent = found.value
  if (typeof parent.parentId === 'string' && parent.parentId.length > 0) {
    return {
      error:
        `${quote(parentId)} is itself a subtask of ${quote(parent.parentId)}, and Jot nests ` +
        `one level only. A subtask of a subtask is written to the file but never shown. ` +
        `Hang it under the root task instead.`
    }
  }
  return { value: parent }
}

/** @param {unknown} value */
function typeName(value) {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'an array'
  }
  if (value === undefined) {
    return 'nothing'
  }
  return `a ${typeof value}`
}

/** @param {unknown} value */
function quote(value) {
  return typeof value === 'string' ? `"${value}"` : String(value)
}

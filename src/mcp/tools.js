/**
 * The MCP tool surface over Jot's board.
 *
 * Kept apart from the server wiring so the whole surface can be exercised without
 * stdio, a transport, or a running process - which is what `scripts/test-mcp-tools.mjs`
 * does.
 *
 * Three rules shape what is here.
 *
 *   **Reads answer a question, they do not dump the file.** A list gives each task
 *   with its list name and tag names resolved and its subtasks counted, sorted the
 *   way the app sorts them. An agent that has to join ids and re-derive the order
 *   gets a different answer from the one on screen, and then the two disagree about
 *   what the board says.
 *
 *   **Descriptions are not in list output.** They hold long free-text notes - the
 *   reason a task was parked, a whole plan - and putting every one of them in every
 *   listing is most of the file for something the caller did not ask for. `jot_todo`
 *   gives one task in full. Helm's board reader draws the same line.
 *
 *   **Every write goes through a refusal.** See `validate.js` for why that is the
 *   point of this server rather than politeness.
 *
 * What is deliberately NOT here:
 *
 *   **Deleting anything.** No tool removes a task, a list or a tag. Removing a
 *   list also deletes every task on it, and none of it is recoverable from the
 *   file afterwards. An agent that reads a board wrong should cost a wrong card,
 *   not a lost list.
 *
 *   **Pinning.** `pinned` makes an always-on-top panel appear on the user's
 *   desktop. That is a claim on his attention right now, made by something he is
 *   not looking at, and it is not the same kind of act as filing a task.
 *
 *   **Tags, and the "Epic" convention that rides on them.** Reads report tag names
 *   so the convention is legible; no tool sets them. Marking work as an epic is a
 *   judgement about scope, and there is an unsettled question about what belongs in
 *   a task title at all - a write path here would answer it by accident.
 */

import crypto from 'node:crypto'

import { mutateBoard, readBoard } from './board.js'
import {
  STATUSES,
  checkCategory,
  checkDeadline,
  checkParent,
  checkPriority,
  checkStatus,
  checkText,
  checkTodo
} from './validate.js'

/** @typedef {{ type: "object", properties: Record<string, any>, required?: string[], additionalProperties: false }} InputSchema */

/** @type {InputSchema} */
const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false }

const ID_ARG = { type: 'string', description: "The task's id, from jot_todos." }

/**
 * Ascending priority, stable within a band.
 *
 * This is the app's order, not a nicer one: `App.tsx` groups open tasks by
 * priority and sorts the groups `a - b`, and its default sort mode inside a group
 * is "manual", which is the array order in the file. So 0 is not "least urgent" -
 * it is zero on a number line where -1 sits above it and 1 below.
 */
function byPriority(todos) {
  return todos
    .map((todo, index) => ({ todo, index }))
    .sort((a, b) => a.todo.priority - b.todo.priority || a.index - b.index)
    .map((entry) => entry.todo)
}

function categoryName(board, categoryId) {
  if (typeof categoryId !== 'string') {
    return null
  }
  const found = board.categories.find((category) => category.id === categoryId)
  return found === undefined ? null : (found.name ?? null)
}

function tagNames(board, tagIds) {
  if (!Array.isArray(tagIds)) {
    return []
  }
  return tagIds.map((tagId) => {
    const found = board.tags.find((tag) => tag.id === tagId)
    // An unknown tag id is reported as the id rather than dropped: a tag deleted
    // in the app leaves its id behind on the card, and silently hiding that makes
    // the board look tidier than it is.
    return found === undefined ? `unknown:${tagId}` : found.name
  })
}

/** Milliseconds as stored, plus a date a reader can check without arithmetic. */
function asDate(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** One task as it appears in a listing. No description - see the file header. */
function summarise(board, todo) {
  const description = typeof todo.description === 'string' ? todo.description : ''
  return {
    id: todo.id,
    text: todo.text,
    status: todo.status,
    priority: todo.priority,
    categoryId: todo.categoryId ?? null,
    category: categoryName(board, todo.categoryId),
    tags: tagNames(board, todo.tags),
    deadline: todo.deadline ?? null,
    deadlineDate: asDate(todo.deadline),
    pinned: todo.pinned === true,
    parentId: todo.parentId ?? null,
    subtasks: board.todos.filter((candidate) => candidate.parentId === todo.id).length,
    // Whether there is a description, and how much of it, without carrying it.
    descriptionChars: description.length,
    createdAt: todo.createdAt ?? null,
    updatedAt: todo.updatedAt ?? null
  }
}

/** One task in full, with its subtasks. */
function detail(board, todo) {
  return {
    ...summarise(board, todo),
    description: typeof todo.description === 'string' ? todo.description : '',
    images: Array.isArray(todo.images) ? todo.images : [],
    completedAt: todo.completedAt ?? null,
    completedDate: asDate(todo.completedAt),
    subtaskList: byPriority(
      board.todos.filter((candidate) => candidate.parentId === todo.id)
    ).map((subtask) => summarise(board, subtask))
  }
}

/**
 * A new todo with every field the app writes, in the order the app writes them.
 *
 * All fifteen, on purpose: `src/core/storage.ts` fills a default for anything
 * missing, so a partial card would load fine and then differ from a hand-made one
 * in ways nothing reports - a `pinned` that is absent rather than false, an
 * `updatedAt` invented at load time. A card created here should be indistinguishable
 * from a card typed into the app.
 */
function newTodo({ text, categoryId, description, priority, deadline, parentId, now }) {
  return {
    id: crypto.randomUUID(),
    text,
    status: 'open',
    description,
    images: [],
    categoryId,
    tags: [],
    priority,
    deadline,
    pinned: false,
    parentId,
    createdAt: now,
    updatedAt: now,
    completedAt: null
  }
}

/** @type {{ name: string, description: string, inputSchema: InputSchema, run: Function }[]} */
export const TOOLS = [
  {
    name: 'jot_categories',
    description:
      "Jot's lists, each with how many tasks sit in each status. Start here: every " +
      'other tool takes a category id, and a list also carries the repo folder it ' +
      "belongs to (repoPath) and whether it is work or private. Counts are root tasks; " +
      'subtasks are counted separately.',
    inputSchema: NO_ARGS,
    run: (todosPath) => {
      const read = readBoard(todosPath)
      if ('error' in read) {
        return { error: read.error }
      }
      const board = read.board

      const count = (todos) => {
        const tally = {}
        for (const status of STATUSES) {
          tally[status] = 0
        }
        for (const todo of todos) {
          // A status the app does not know is reported under its own key rather
          // than dropped, because it means something already wrote a bad value.
          tally[todo.status] = (tally[todo.status] ?? 0) + 1
        }
        return tally
      }

      const lists = board.categories.map((category) => {
        const mine = board.todos.filter((todo) => todo.categoryId === category.id)
        const roots = mine.filter((todo) => todo.parentId === null || todo.parentId === undefined)
        return {
          id: category.id,
          name: category.name,
          domain: category.domain ?? null,
          repoPath: category.repoPath ?? null,
          tasks: count(roots),
          subtasks: mine.length - roots.length
        }
      })

      const loose = board.todos.filter((todo) => {
        return todo.categoryId === null || todo.categoryId === undefined
      })

      return {
        lists,
        // Tasks on no list at all. They exist and are easy to lose sight of, since
        // they only show under "All" in the app.
        withoutCategory: {
          tasks: count(
            loose.filter((todo) => todo.parentId === null || todo.parentId === undefined)
          ),
          total: loose.length
        },
        statuses: STATUSES
      }
    }
  },
  {
    name: 'jot_todos',
    description:
      'Tasks on the board, in the order the app shows them: priority ascending, ' +
      'and within one priority the manual drag order. Lower priority number is more ' +
      'urgent, and 0 means "no priority" - so -1 sits above 0 and 1 below it. Root ' +
      'tasks only unless you ask otherwise, so nothing is counted twice.',
    inputSchema: {
      type: 'object',
      properties: {
        categoryId: {
          type: 'string',
          description: "A list id from jot_categories, or a list's exact name."
        },
        status: { type: 'string', description: STATUSES.join(' | ') },
        parentId: {
          type: 'string',
          description: "Only this task's subtasks. Overrides includeSubtasks."
        },
        includeSubtasks: {
          type: 'boolean',
          description: 'Include subtasks alongside root tasks. Defaults to false.'
        }
      },
      additionalProperties: false
    },
    run: (todosPath, args) => {
      const read = readBoard(todosPath)
      if ('error' in read) {
        return { error: read.error }
      }
      const board = read.board

      let category = null
      if (args.categoryId !== undefined) {
        const resolved = checkCategory(board, args.categoryId)
        if ('error' in resolved) {
          return resolved
        }
        category = resolved.value
      }

      let status = null
      if (args.status !== undefined) {
        const resolved = checkStatus(args.status)
        if ('error' in resolved) {
          return resolved
        }
        status = resolved.value
      }

      let parent = null
      if (args.parentId !== undefined) {
        const resolved = checkTodo(board, args.parentId, 'parentId')
        if ('error' in resolved) {
          return resolved
        }
        parent = resolved.value
      }

      const matches = board.todos.filter((todo) => {
        if (parent !== null) {
          if (todo.parentId !== parent.id) {
            return false
          }
        } else if (args.includeSubtasks !== true) {
          if (todo.parentId !== null && todo.parentId !== undefined) {
            return false
          }
        }
        if (category !== null && todo.categoryId !== category.id) {
          return false
        }
        if (status !== null && todo.status !== status) {
          return false
        }
        return true
      })

      return {
        count: matches.length,
        filters: {
          category: category === null ? null : { id: category.id, name: category.name },
          status,
          parentId: parent === null ? null : parent.id,
          includeSubtasks: parent === null && args.includeSubtasks === true
        },
        todos: byPriority(matches).map((todo) => summarise(board, todo))
      }
    }
  },
  {
    name: 'jot_todo',
    description:
      'One task in full: its description, images, timestamps and its subtasks. Use ' +
      'this when the summary from jot_todos is not enough - the description is where ' +
      'the reason a task was parked or bounced is written.',
    inputSchema: {
      type: 'object',
      properties: { id: ID_ARG },
      required: ['id'],
      additionalProperties: false
    },
    run: (todosPath, args) => {
      const read = readBoard(todosPath)
      if ('error' in read) {
        return { error: read.error }
      }
      const found = checkTodo(read.board, args.id)
      if ('error' in found) {
        return found
      }
      return { todo: detail(read.board, found.value) }
    }
  },

  {
    name: 'jot_add_todo',
    description:
      'Add a task. It lands at the top of its list as "open", exactly as quick ' +
      'capture in the app does. Omitting categoryId puts it on no list, where it ' +
      'shows only under "All" - name a list unless there is a reason not to.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The title. One line.' },
        categoryId: {
          type: 'string',
          description: "A list id from jot_categories, or a list's exact name."
        },
        description: {
          type: 'string',
          description:
            'Longer notes. Markdown. Put the why here rather than growing the title.'
        },
        priority: {
          type: 'number',
          description: 'Whole number, lower is more urgent. 0 (the default) means none.'
        },
        deadline: { type: 'number', description: 'Milliseconds since the epoch, or null.' }
      },
      required: ['text'],
      additionalProperties: false
    },
    run: (todosPath, args, now) =>
      mutateBoard(todosPath, (board) => {
        const text = checkText(args.text)
        if ('error' in text) {
          return text
        }
        const category = checkCategory(board, args.categoryId)
        if ('error' in category) {
          return category
        }
        const priority = checkPriority(args.priority ?? 0)
        if ('error' in priority) {
          return priority
        }
        const deadline = checkDeadline(args.deadline)
        if ('error' in deadline) {
          return deadline
        }
        if (args.description !== undefined && typeof args.description !== 'string') {
          return { error: 'A description must be a string.' }
        }

        const todo = newTodo({
          text: text.value,
          categoryId: category.value === null ? null : category.value.id,
          description: args.description ?? '',
          priority: priority.value,
          deadline: deadline.value,
          parentId: null,
          now
        })
        // Newest on top, matching the app's capture flow.
        board.todos.unshift(todo)
        return { added: summarise(board, todo) }
      })
  },
  {
    name: 'jot_add_subtask',
    description:
      "Add a subtask under an existing task. It inherits the parent's list and " +
      'starts at "open" with no priority, which is what the app does. Nesting is one ' +
      'level: a subtask cannot take subtasks of its own.',
    inputSchema: {
      type: 'object',
      properties: {
        parentId: { type: 'string', description: 'The root task it belongs to.' },
        text: { type: 'string', description: 'The subtask title.' }
      },
      required: ['parentId', 'text'],
      additionalProperties: false
    },
    run: (todosPath, args, now) =>
      mutateBoard(todosPath, (board) => {
        const parent = checkParent(board, args.parentId)
        if ('error' in parent) {
          return parent
        }
        const text = checkText(args.text)
        if ('error' in text) {
          return text
        }

        const subtask = newTodo({
          text: text.value,
          categoryId: parent.value.categoryId ?? null,
          description: '',
          priority: 0,
          deadline: null,
          parentId: parent.value.id,
          now
        })
        board.todos.unshift(subtask)
        return { added: summarise(board, subtask), parent: parent.value.text }
      })
  },
  {
    name: 'jot_set_status',
    description:
      'Move a task between open, in-progress, review and done. Finishing a task ' +
      'stamps completedAt and unpins it, the same way the app does. Work that is ' +
      'finished belongs in "review" rather than "done" unless the user says otherwise - ' +
      'done is his call, made after looking at it.',
    inputSchema: {
      type: 'object',
      properties: { id: ID_ARG, status: { type: 'string', description: STATUSES.join(' | ') } },
      required: ['id', 'status'],
      additionalProperties: false
    },
    run: (todosPath, args, now) =>
      mutateBoard(todosPath, (board) => {
        const found = checkTodo(board, args.id)
        if ('error' in found) {
          return found
        }
        const status = checkStatus(args.status)
        if ('error' in status) {
          return status
        }

        const todo = found.value
        const from = todo.status
        todo.status = status.value
        // Both mirror the app's setStatus: a finished task drops off the desktop
        // panel, and completedAt is cleared again if it comes back out of done.
        todo.pinned = status.value === 'done' ? false : todo.pinned === true
        todo.completedAt = status.value === 'done' ? now : null
        todo.updatedAt = now
        return { changed: { field: 'status', from, to: status.value }, todo: summarise(board, todo) }
      })
  },
  {
    name: 'jot_set_description',
    description:
      "Replace a task's description. This is the field to write the reason in when " +
      'a task is parked, bounced back from review, or left half-done - it is what the ' +
      'next session reads. Replaces rather than appends, so read the task first if the ' +
      'existing text matters. An empty string clears it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: ID_ARG,
        description: { type: 'string', description: 'Markdown. Replaces what is there.' }
      },
      required: ['id', 'description'],
      additionalProperties: false
    },
    run: (todosPath, args, now) =>
      mutateBoard(todosPath, (board) => {
        const found = checkTodo(board, args.id)
        if ('error' in found) {
          return found
        }
        if (typeof args.description !== 'string') {
          return { error: 'A description must be a string. Pass "" to clear it.' }
        }

        const todo = found.value
        const before = typeof todo.description === 'string' ? todo.description : ''
        todo.description = args.description
        todo.updatedAt = now
        return {
          changed: { field: 'description', fromChars: before.length, toChars: args.description.length },
          todo: summarise(board, todo)
        }
      })
  },
  {
    name: 'jot_set_priority',
    description:
      "Set a task's priority. Whole number, lower is more urgent, and 0 means no " +
      'priority - so -1 puts something above the unprioritised pile and 1 puts it below. ' +
      'This is the order the board is read in, so it is a claim about what comes first.',
    inputSchema: {
      type: 'object',
      properties: { id: ID_ARG, priority: { type: 'number', description: 'Whole number.' } },
      required: ['id', 'priority'],
      additionalProperties: false
    },
    run: (todosPath, args, now) =>
      mutateBoard(todosPath, (board) => {
        const found = checkTodo(board, args.id)
        if ('error' in found) {
          return found
        }
        const priority = checkPriority(args.priority)
        if ('error' in priority) {
          return priority
        }

        const todo = found.value
        const from = todo.priority
        todo.priority = priority.value
        todo.updatedAt = now
        return {
          changed: { field: 'priority', from, to: priority.value },
          todo: summarise(board, todo)
        }
      })
  }
]

/**
 * Run one tool by name.
 *
 * Failures come back as data, never as a thrown exception. An agent handed
 * "unknown category X, the lists are A, B, C" fixes its own call; one handed a
 * stack trace tells the user something went wrong and stops.
 *
 * @param {string} todosPath
 * @param {string} name
 * @param {any} args
 * @param {number} now
 */
export function callTool(todosPath, name, args, now) {
  const tool = TOOLS.find((candidate) => candidate.name === name)
  if (tool === undefined) {
    return { error: `Unknown tool "${name}". Available: ${TOOLS.map((t) => t.name).join(', ')}.` }
  }
  try {
    return tool.run(todosPath, args ?? {}, now)
  } catch (error) {
    return { error: `${name} failed: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** The list an MCP client sees, without the run functions. */
export function toolManifest() {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}

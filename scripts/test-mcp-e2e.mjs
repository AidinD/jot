// The MCP server as a PROCESS: does it start, speak the protocol, find the board
// the environment points it at, and write to it?
//
// test-mcp-tools.mjs proves the tools behave, but it imports them directly and so
// never runs src/mcp/server.js at all - a typo in the wiring, a bad import, or a
// diagnostic written to stdout instead of stderr would all ship green. Those are
// exactly the failures that make a client show "server disconnected" with nothing
// to go on.
//
// Runs against a scratch directory, never the real board.
//
// Run:  node scripts/test-mcp-e2e.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { promises as fsp, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import os from 'os'
import { fileURLToPath } from 'url'

let exitCode = 0
function assert(cond, msg) {
  console.log(`${cond ? 'OK  ' : 'FAIL'} - ${msg}`)
  if (!cond) {
    exitCode = 1
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const serverPath = join(here, '..', 'src', 'mcp', 'server.js')
const dir = await fsp.mkdtemp(join(os.tmpdir(), 'jot-mcp-e2e-'))
const todosPath = join(dir, 'todos.json')

writeFileSync(
  todosPath,
  JSON.stringify(
    {
      todos: [],
      categories: [{ id: 'cat-1', name: 'Work', color: '#4fc3d9', createdAt: 1, domain: 'work' }],
      tags: []
    },
    null,
    2
  ),
  'utf8'
)

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  // The server must read the board this points at and not the real one. If it
  // ignored the variable, every check below would still pass while quietly
  // operating on the user's actual data - so the last check reads the scratch file.
  env: { ...process.env, JOT_DATA_DIR: dir },
  stderr: 'pipe'
})

const client = new Client({ name: 'jot-e2e', version: '1.0.0' }, { capabilities: {} })

const payload = (result) => JSON.parse(result.content[0].text)

try {
  await client.connect(transport)
  assert(true, 'the server starts and completes the protocol handshake')

  const { tools } = await client.listTools()
  assert(tools.length === 8, `it advertises its tools (${tools.length})`)
  assert(
    ['jot_categories', 'jot_todos', 'jot_add_todo', 'jot_set_status'].every((name) =>
      tools.some((tool) => tool.name === name)
    ),
    'including the ones the assistant seat needs'
  )

  const lists = payload(await client.callTool({ name: 'jot_categories', arguments: {} }))
  assert(
    lists.lists.length === 1 && lists.lists[0].name === 'Work',
    'a read comes back over the wire'
  )

  const added = payload(
    await client.callTool({
      name: 'jot_add_todo',
      arguments: { text: 'Written over MCP', categoryId: 'cat-1' }
    })
  )
  assert(added.added?.id !== undefined, 'a write comes back with the task it created')

  const refused = await client.callTool({
    name: 'jot_set_status',
    arguments: { id: added.added.id, status: 'nonsense' }
  })
  assert(refused.isError === true, 'a refusal arrives as an error, not a success with a sad message')
  assert(
    typeof payload(refused).error === 'string' && payload(refused).error.includes('Unknown status'),
    'and carries the reason in its content too, for a client that only shows content'
  )

  const onDisk = JSON.parse(readFileSync(todosPath, 'utf8'))
  assert(
    onDisk.todos.length === 1 && onDisk.todos[0].text === 'Written over MCP',
    'and the write really landed in the board JOT_DATA_DIR pointed at'
  )
  assert(onDisk.todos[0].status === 'open', 'with the refused status never applied')

  console.log(
    exitCode === 0
      ? 'VERIFY OK: the real server process starts, lists its tools, reads, writes and refuses.'
      : 'VERIFY FAILED.'
  )
} catch (error) {
  assert(false, `the server could not be driven: ${error instanceof Error ? error.message : error}`)
} finally {
  await client.close().catch(() => {})
  await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
}
process.exit(exitCode)

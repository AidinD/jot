#!/usr/bin/env node
/**
 * Jot's MCP server.
 *
 * A standalone Node process over the same `todos.json` the app uses, so it works
 * with the app closed. That is the whole reason this is MCP over a file rather
 * than an HTTP API the app would have to be running to serve.
 *
 * It exists because of a guard, not a feature request. Helm's assistant seat
 * denies every file-writing tool at the hook level and exempts MCP tools
 * (helm/DECISIONS.md, "An assistant seat is not a first mate with a different
 * manual"). The path-aware alternative was rejected there because a guard that
 * allows any write inside a folder allows an invalid one, and an invalid write to
 * this board does not fail loudly - it produces a card in a list that does not
 * exist, or a status the app rewrites on next load. This surface can refuse.
 *
 * Wire it up in .mcp.json:
 *
 *   { "mcpServers": { "jot": { "command": "node",
 *     "args": ["D:/Repo/Tools/jot/src/mcp/server.js"],
 *     "env": { "JOT_DATA_DIR": "..." } } } }
 *
 * Anything written to stdout is protocol. Diagnostics go to stderr.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveJotDataDir, resolveTodosPath } from './board.js'
import { callTool, toolManifest } from './tools.js'

const { dir, source } = resolveJotDataDir()
const todosPath = resolveTodosPath(dir)

// Reported at startup because the commonest way this goes wrong is silent: the
// server and the app resolve different data directories, each reads a real board,
// and both look correct while the user's edits and the agent's never meet.
process.stderr.write(`[jot] board: ${todosPath} (${source})\n`)

const server = new Server({ name: 'jot', version: readVersion() }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolManifest() }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Date.now() is taken per call rather than at startup: this process is
  // long-lived, and a createdAt from whenever the client happened to launch would
  // be wrong by hours.
  const result = callTool(todosPath, request.params.name, request.params.arguments, Date.now())
  const failed = result !== null && typeof result === 'object' && 'error' in result

  // A refusal is reported as an MCP error AND carries its text in the content, so
  // it reads the same whether the client surfaces errors or only content.
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: failed
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
process.stderr.write('[jot] ready\n')

/**
 * Jot's version, read from package.json at startup.
 *
 * Hardcoding it here would mean a second place to bump on every release, and the
 * one that gets forgotten is the one nobody looks at.
 */
function readVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8'))
    return String(pkg.version)
  } catch {
    return '0.0.0'
  }
}

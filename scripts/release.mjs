// Publish a release: check, clean, build, package, upload.
//
// Jot was the last app in the suite still releasing from a command line typed out
// of CLAUDE.md, and it is the app whose incidents put two of the guards in
// `keel/release` in the first place:
//
//  - `out/` MUST be cleared before packaging. electron-builder happily packages
//    whatever is already sitting there without a word of complaint, so a skipped
//    build ships the previous build's code under a new version number. That is
//    exactly what happened on 2026-08-04: v1.5.30 was published straight from the
//    previous day's `out/`, so none of that release's actual changes were in the
//    installer.
//  - The version must not already be released. electron-builder treats a release
//    older than two hours as untouchable, skips `latest.yml` with a notice in the
//    middle of its output, and exits 0 - so the failure is shaped exactly like a
//    success and the updater carries on offering the old build.
//
// A typed command line cannot check either of those. This can, so the release
// instructions are now `npm run release` rather than four commands joined by `&&`
// with a warning above them.
//
// The upload has to be electron-builder's own publisher: it names the installer
// in the dashed form `latest.yml` references, where a hand-made `gh release
// create` upload gets a name with spaces and electron-updater then 404s on an
// asset in a release that looks perfectly published (DECISIONS 2026-07-04).
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { appMeta, clean, ghToken, nodeExec, preflight } from 'keel/release'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const exec = nodeExec(root)
const { name, version, tag } = appMeta(root)

/** @param {string} message */
function fail(message) {
  console.error(`\n${message}`)
  process.exit(1)
}

/** @param {string} command @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
function run(command, args, env = process.env) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: true, env })
}

console.log(`Releasing ${name} ${version}`)

// Before anything is built, so a refusal costs no time.
const failures = preflight(exec, { tag, checks: ['cleanTree', 'notAlreadyReleased'] })
if (failures.length > 0) {
  fail(failures.map((failure) => failure.message).join('\n\n'))
}

try {
  clean(root, ['out', 'dist'])
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

// Not optional, even though electron-builder runs without complaining if you skip
// it. See the top of this file.
run('npx', ['electron-vite', 'build'])

let token
try {
  token = ghToken(exec)
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}

run('npx', ['electron-builder', '--win', '--publish', 'always'], {
  ...process.env,
  GH_TOKEN: token
})

console.log(
  `\nPublished ${version}. No manual install needed - an installed copy's` +
    ' electron-updater picks it up on its next launch.'
)

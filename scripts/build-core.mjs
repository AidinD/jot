// Build @jot/core as a standalone, consumable ESM package (DECISIONS 2026-07-18
// "Split into core + UI"). The standalone app keeps importing src/core directly
// via electron-vite; this build produces the distributable a SECOND shell (Helm)
// imports - Helm's vanilla-JS main pulls @jot/core to run the data layer, while
// it embeds Jot's built renderer for the UI. Output (dist-core/) is git-ignored;
// consumers build it (or we publish later).
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(repoRoot, 'dist-core')

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

// Bundle to one ESM file; node builtins (fs/crypto/path) stay external. The core
// has no third-party dependencies, so nothing else needs externalizing.
await build({
  entryPoints: [path.join(repoRoot, 'src/core/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: path.join(outDir, 'index.mjs')
})

// Type declarations (bundler resolution tolerates the source's extensionless imports).
execSync('npx tsc -p tsconfig.core.json', { cwd: repoRoot, stdio: 'inherit' })

// The manifest external consumers import. ESM to match this repo (type: module).
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
fs.writeFileSync(
  path.join(outDir, 'package.json'),
  JSON.stringify(
    {
      name: '@jot/core',
      version: pkg.version,
      type: 'module',
      main: './index.mjs',
      module: './index.mjs',
      types: './index.d.ts',
      exports: { '.': { types: './index.d.ts', import: './index.mjs' } }
    },
    null,
    2
  ) + '\n'
)

console.log('Built @jot/core ->', path.relative(repoRoot, outDir))

/**
 * `npm publish` gate.
 *
 * Publishing is the one irreversible step in this package's life: a version
 * cannot be replaced, and the community registry links an npm package to a
 * repository by reading the published `repository` field, so a placeholder that
 * reaches the registry is a package permanently attached to nothing. This check
 * runs on `prepublishOnly` (publish only, never `pack`) and refuses the obvious
 * mistakes before the tarball leaves the machine.
 */

import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const problems = []

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

if (manifest.private === true) problems.push('package.json still says "private": true')
if (!/^\d+\.\d+\.\d+/u.test(String(manifest.version ?? ''))) problems.push(`version "${manifest.version}" is not a plain semver`)
if (JSON.stringify(manifest).includes('CHANGE-ME')) {
  problems.push('repository/homepage/bugs still point at CHANGE-ME — set the real repository, the registry links a package to its repo through that field')
}
if (manifest.dsh?.bundle?.patch === undefined) problems.push('dsh.bundle.patch is missing, so `dsh plugin add` cannot mount the package')

/** Every file the loader and the manifest promise must be present. */
const required = [
  manifest.dsh?.bundle?.patch?.replace(/^\.\//u, '') ?? 'cordis.patch.yml',
  'lib/index.js',
  'lib/live.js',
  'lib/host.js',
  'lib/net.js',
  'client/client.js',
  'README.md',
  'LICENSE',
]
for (const relative of required) {
  try {
    if (!statSync(join(ROOT, relative)).isFile()) problems.push(`${relative} is not a file`)
  } catch {
    problems.push(`${relative} is missing`)
  }
}

// `lib/live.js` is the module URL the loader row names, and it is only correct
// while it is a byte-identical copy of the stable entry.
try {
  const entry = readFileSync(join(ROOT, 'lib/index.js'))
  const live = readFileSync(join(ROOT, 'lib/live.js'))
  if (!entry.equals(live)) problems.push('lib/live.js drifted from lib/index.js — copy it again before publishing')
} catch {
  // Already reported as missing above.
}

if (problems.length > 0) {
  console.error('\nrefusing to publish dsh-model-icons:')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('\nfix these, then publish again.\n')
  process.exit(1)
}

console.log(`dsh-model-icons ${manifest.version} is ready to publish`)

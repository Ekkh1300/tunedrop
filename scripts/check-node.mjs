/**
 * Requirements check, run after `npm install`.
 * TuneDrop needs Node >= 22.5 for the built-in `node:sqlite` module,
 * which keeps the project free of native database dependencies.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const [major, minor] = process.versions.node.split('.').map(Number)

try {
  require('node:sqlite')
} catch {
  major >= 22 && console.error(
    `[tunedrop] This Node version (${process.versions.node}) cannot load node:sqlite.\n` +
    'Install Node.js 22.5 or newer: https://nodejs.org'
  )
  process.exit(1)
}

if (major < 22 || (major === 22 && minor < 5)) {
  console.error(
    `[tunedrop] Node ${process.versions.node} found, but Node >= 22.5 is required (for node:sqlite).\n` +
    'Upgrade: https://nodejs.org'
  )
  process.exit(1)
}

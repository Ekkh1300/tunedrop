/**
 * Development orchestrator.
 * Spawns the API server (node --watch) and the Vite dev server side by side,
 * tags their output, and forwards Ctrl+C to both children.
 *
 *   node scripts/dev.mjs
 */
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'

const children = []

function start(label, command, args, cwd, color) {
  const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  const tag = `\x1b[${color}m[${label}]\x1b[0m `
  const pipe = (stream, out) => {
    let buffered = ''
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => {
      buffered += chunk
      const lines = buffered.split('\n')
      buffered = lines.pop() // keep incomplete last line in the buffer
      for (const line of lines) out.write(tag + line + '\n')
    })
    stream.on('end', () => { if (buffered) out.write(tag + buffered + '\n') })
  }
  pipe(child.stdout, process.stdout)
  pipe(child.stderr, process.stderr)
  child.on('exit', (code) => {
    process.stdout.write(tag + `exited (code ${code ?? 'signal'})\n`)
  })
  children.push(child)
  return child
}

start('server', process.execPath, ['--watch', 'src/index.js'], resolve(ROOT, 'server'), '36')
start('client', process.execPath, [resolve(ROOT, 'client', 'node_modules', 'vite', 'bin', 'vite.js'), '--host'], resolve(ROOT, 'client'), '35')

process.stdout.write('\x1b[2m[dev] PC: http://localhost:5173 · phone on same Wi-Fi: http://<pc-ip>:5173\x1b[0m\n')

function shutdown() {
  for (const child of children) {
    if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  }
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

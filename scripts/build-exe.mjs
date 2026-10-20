/**
 * Builds TuneDrop.exe — the whole app in one Windows executable:
 *   1. build the web client (vite)
 *   2. bundle the server with esbuild into a single CJS file
 *   3. turn that into a Node Single Executable blob (--experimental-sea-config),
 *      embedding the client dist as assets (served from memory at runtime)
 *   4. inject the blob into a copy of node.exe (postject)
 *   5. stamp the icon + metadata (rcedit)
 *
 * Result: app/TuneDrop.exe — double-click → server + browser, like the .bat
 * but with no Node install required on the target machine.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CLIENT_DIST = path.join(ROOT, 'client', 'dist')
const TMP = path.join(ROOT, 'tmp-sea')
const OUT_DIR = path.join(ROOT, 'app')
const OUT_EXE = path.join(OUT_DIR, 'TuneDrop.exe')
const ICON = path.join(ROOT, 'assets', 'tunedrop.ico')
/* direct binaries — spawnSync cannot launch .cmd shims without a shell */
const NPM = 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'
const ESBUILD = path.join(ROOT, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe')
const POSTJECT = path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js')

const log = (m) => console.log(`\x1b[33m[exe]\x1b[0m ${m}`)
const die = (m) => {
  console.error(`\x1b[31m[exe] FAILED:\x1b[0m ${m}`)
  process.exit(1)
}
const run = (cmd, args, { cwd = ROOT } = {}) => {
  const r = spawnSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false })
  const out = (r.stdout?.toString() ?? '') + (r.stderr?.toString() ?? '')
  if (r.status !== 0) die(`${cmd} ${args.join(' ')}\n${out}`)
  return out
}

/* 1 ─ client build */
log('building web client…')
run(process.execPath, [NPM, 'run', 'build'])
if (!existsSync(path.join(CLIENT_DIST, 'index.html'))) die('client build did not produce index.html')

/* 2 ─ server bundle */
log('bundling server (esbuild)…')
rmSync(TMP, { recursive: true, force: true })
mkdirSync(TMP, { recursive: true })
run(ESBUILD, [
  'server/src/index.js',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--minify',
  '--define:process.env.TUNEDROP_BUNDLED="sea"',
  '--log-level=warning',
  `--outfile=${path.join(TMP, 'server-bundle.cjs')}`,
])

/* 3 ─ SEA blob with embedded assets */
log('collecting client files into SEA assets…')
/** @returns {Array<[key, absolutePath]>} every file of the client dist */
function distFiles() {
  const files = []
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      const relFull = rel ? `${rel}/${name}` : name
      if (statSync(full).isDirectory()) walk(full, relFull)
      else files.push([`client/dist/${relFull}`, full])
    }
  }
  walk(CLIENT_DIST, '')
  return files
}
const assets = Object.fromEntries(distFiles())
const manifest = JSON.stringify(Object.keys(assets))
const manifestPath = path.join(TMP, 'sea-manifest.json')
writeFileSync(manifestPath, manifest)

const seaConfig = {
  main: path.join(TMP, 'server-bundle.cjs'),
  output: path.join(TMP, 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets: { 'sea-manifest': manifestPath, ...assets },
}
const seaConfigPath = path.join(TMP, 'sea-config.json')
writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2))
log(`SEA config: ${Object.keys(assets).length + 1} assets`)

log('compiling SEA blob…')
run(process.execPath, ['--experimental-sea-config', seaConfigPath])

/* 4 ─ inject into node.exe */
log('creating TuneDrop.exe from the Node runtime…')
mkdirSync(OUT_DIR, { recursive: true })
copyFileSync(process.execPath, OUT_EXE)

log('injecting the blob (postject)…')
run(process.execPath, [POSTJECT, OUT_EXE, 'NODE_SEA_BLOB', path.join(TMP, 'sea-prep.blob'),
  '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'])

/* 5 ─ icon + metadata via the native UpdateResource API (fast, reliable;
   rcedit thrashes on the ~105 MB file). The script keeps existing resources,
   so node.exe's manifest survives. */
log('stamping icon (UpdateResource)…')
run('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-File', path.join(ROOT, 'scripts', 'set-icon.ps1'),
  '-Exe', OUT_EXE,
  '-Ico', ICON,
])

/* lightweight companion readme for the exe folder */
writeFileSync(
  path.join(OUT_DIR, 'README.txt'),
  readFileSync(path.join(ROOT, 'README.md'), 'utf8').slice(0, 0) +
    'TuneDrop\r\n=======\r\nDouble-click TuneDrop.exe:\r\n' +
    '  - starts the library server and opens http://localhost:8787 in the browser\r\n' +
    '  - first run puts shortcuts on the Desktop and the Start menu\r\n' +
    '  - songs and the database live in the "data" folder next to this file\r\n' +
    '  - Run with --no-open to skip the browser\r\n' +
    '  - Run with --uninstall to remove the shortcuts\r\n\r\n' +
    'Phone: same Wi-Fi, scan the QR from the web page.\r\n' +
    'Full docs: see README.md in the TuneDrop project folder.\r\n',
)

const size = statSync(OUT_EXE).size / (1024 * 1024)
log(`\x1b[32mdone\x1b[0m ${OUT_EXE} — ${size.toFixed(1)} MB`)

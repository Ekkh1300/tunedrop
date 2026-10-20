/**
 * TuneDrop server entry point.
 *  - boots express + socket.io on 0.0.0.0 so phones on the LAN can reach it,
 *  - logs the exact URLs to open on each device,
 *  - runs storage housekeeping on a low-frequency timer,
 *  - as a single-file exe (TUNEDROP_BUNDLED): embeds the UI in the binary,
 *    opens the browser and installs Desktop/Start-Menu shortcuts on first run.
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { exec } from 'node:child_process'
import path from 'node:path'
import { createApp } from './app.js'
import { initSockets } from './sockets.js'
import { housekeeping } from './services/rooms.js'
import {
  BUNDLED,
  CLIENT_DIST_DIR,
  DATA_DIR,
  HOST,
  PORT,
  MAX_ROOM_STORAGE_MB,
  MAX_UPLOAD_MB,
} from './config.js'
import { bestLanUrl, lanAddresses } from './utils/lan.js'

/** Single-exe (SEA) assets: { keys: Set<string>, get(key) → Buffer } or null. */
async function embeddedUiAssets() {
  if (existsSync(CLIENT_DIST_DIR)) return null // a repo layout keeps the disk UI
  try {
    const sea = await import('node:sea')
    if (!sea.isSea?.()) return null
    const manifest = Buffer.from(sea.getRawAsset('sea-manifest')).toString('utf8')
    const keys = new Set(JSON.parse(manifest))
    keys.add('client/dist/index.html')
    return { keys, get: (key) => Buffer.from(sea.getRawAsset(key)) }
  } catch {
    return null
  }
}

/* first-run "installer" for the single-exe build:
 *  - `--uninstall`: removes the Desktop/Start-Menu shortcuts and exits,
 *  - first launch otherwise: creates shortcuts so the exe behaves like an app. */
async function installerStep() {
  const exe = process.execPath
  const desktop = process.env.USERPROFILE ? `${process.env.USERPROFILE}\\Desktop` : null
  const startMenu = process.env.APPDATA
    ? `${process.env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs`
    : null
  const flag = path.join(DATA_DIR, 'installed.flag')

  if (process.argv.includes('--uninstall')) {
    await runPs(
      [desktop, startMenu]
        .filter(Boolean)
        .map((dir) => `Remove-Item -ErrorAction SilentlyContinue '${dir}\\TuneDrop.lnk'`),
    )
    console.log('  TuneDrop shortcuts were removed.')
    setTimeout(() => process.exit(0), 2500).unref()
    return
  }
  if (existsSync(flag)) return // installed already — plain app start
  try {
    writeFileSync(flag, new Date().toISOString() + '\n')
  } catch {
    /* read-only location — skip marking, try again next time */
  }
  await runPs([desktop, startMenu].filter(Boolean).map((dir) => shortCutScript(exe, dir)))
  console.log('  First run: shortcuts put on the Desktop and the Start menu.')

  function shortCutScript(exePath, dir) {
    return (
      "$s = $ws.CreateShortcut('" + dir + "\\TuneDrop.lnk'); " +
      "$s.TargetPath = '" + exePath + "'; " +
      "$s.WorkingDirectory = '" + path.dirname(exePath) + "'; " +
      "$s.IconLocation = '" + exePath + ",0'; " +
      "$s.Description = 'TuneDrop — music from your phone, on your PC'; $s.Save()"
    )
  }

  function runPs(parts) {
    const command =
      '-NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; ' +
      parts.join('; ') + '"'
    return new Promise((resolve) => {
      exec(`powershell ${command}`, { windowsHide: true }, () => resolve())
    })
  }
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true })

  const app = createApp({ seaAssets: await embeddedUiAssets() })
  const httpServer = createServer(app)
  const isDev = process.env.NODE_ENV !== 'production'
  initSockets(httpServer, { dev: isDev })

  /* exe installer behaviour: prepare shortcuts once, then behave like an app */
  if (BUNDLED) await installerStep()

  httpServer.listen(PORT, HOST, () => {
    const ips = lanAddresses().map((i) => i.address)
    console.log('')
    console.log('  TuneDrop server is running')
    console.log(`  caps: ${MAX_UPLOAD_MB} MB/file · ${MAX_ROOM_STORAGE_MB} MB per library`)
    console.log('')
    console.log('  On this PC:')
    console.log(`    http://localhost:${PORT}`)
    console.log('')
    console.log('  On the phone (same Wi-Fi):')
    if (ips.length === 0) console.log('    (no LAN IPv4 found — check the Wi-Fi/Ethernet adapter)')
    for (const ip of ips.slice(0, 4)) console.log(`    http://${ip}:${PORT}`)
    console.log('')
    if (!BUNDLED && !existsSync(CLIENT_DIST_DIR)) {
      console.log('  web client is not built yet:')
      console.log('    npm run build    (then keep this server running)')
      console.log('    npm run dev      (development, hot reload)')
      console.log('')
    }

    /* exe mode opens the page like an app would */
    if (BUNDLED && !process.argv.includes('--no-open')) {
      exec(`start "" "http://localhost:${PORT}"`, { shell: 'cmd.exe' })
    }
  })

  /* friendly port conflict — very likely a second TuneDrop double-click */
  httpServer.on('error', (err) => {
    if (err?.code === 'EADDRINUSE') {
      console.log(`  Port ${PORT} is busy — another TuneDrop is probably already running.`)
      console.log('  Opening that one instead; this window can be closed.')
      if (BUNDLED) exec(`start "" "http://localhost:${PORT}"`, { shell: 'cmd.exe' })
      setTimeout(() => process.exit(0), 4000).unref()
      return
    }
    console.error('[server error]', err)
    process.exit(1)
  })

  /* housekeeping every 5 minutes: expired join tokens, stale empty rooms */
  const FIVE_MIN = 5 * 60 * 1000
  const timer = setInterval(() => {
    try {
      housekeeping()
    } catch (err) {
      console.error('[housekeeping] failed:', err?.message ?? err)
    }
  }, FIVE_MIN)
  timer.unref() // cleanup must never hold the process open

  process.on('SIGINT', () => {
    console.log('\n[closing] TuneDrop is shutting down — flushing the database.')
    httpServer.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500).unref()
  })
}

// SEA bundles are CJS — top-level await is not an option, run explicitly
main().catch((err) => {
  console.error('[fatal] TuneDrop failed to start:', err)
  process.exit(1)
})

/**
 * Express wiring: security headers, JSON body, routes, error mapping, built
 * client static serving (production), plus the human-readable error contract.
 *
 * Error contract: every API failure is  { error: { code, message } }  where
 * `message` is safe to show verbatim to the user.
 */
import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import apiRoutes from './routes/index.js'
import { CLIENT_DIST_DIR } from './config.js'

export function createApp({ seaAssets = null } = {}) {
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', false) // LAN app: clients connect directly

  /* security headers (only for responses this server renders) */
  app.use((req, res, next) => {
    res.set({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cross-origin-resource-policy': 'same-origin',
      // media + api are same-origin; data: is needed for inline QR svg data URIs
      'content-security-policy':
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
        "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss: http: https:; " +
        "font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    })
    next()
  })

  app.use(express.json({ limit: '64kb' }))

  /* API */
  app.use(apiRoutes)

  /* 404 for unknown API paths (JSON) */
  app.use('/api', (req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route.' } })
  })

  /* built client (production). Disc wins (repo runs); inside the single-file
     exe the UI comes from embedded Single-Executable assets. hash routing
     means no history fallback needed beyond index.html. */
  if (seaAssets) {
    const cache = new Map()
    app.get(/.*/, (req, res, next) => {
      if (req.method !== 'GET') return next()
      const rel = decodeURIComponent(req.path).replace(/^\/+/, '')
      const key = rel && rel !== 'index.html' ? `client/dist/${rel}` : 'client/dist/index.html'
      if (!seaAssets.keys.has(key)) return next() // unknown → index fallback below
      try {
        if (!cache.has(key)) cache.set(key, seaAssets.get(key))
        const buf = cache.get(key)
        res
          .status(200)
          .type(mimeFor(key))
          .set('cache-control', key.endsWith('.html') ? 'no-store' : 'public, max-age=86400')
          .send(buf)
      } catch (err) {
        next(err)
      }
    })
    // SPA fallback: serve the embedded index for anything else
    app.use((req, res) => {
      const buf = cache.get('client/dist/index.html') ?? seaAssets.get('client/dist/index.html')
      cache.set('client/dist/index.html', buf)
      res.status(200).type('html').set('cache-control', 'no-store').send(buf)
    })
  } else if (existsSync(CLIENT_DIST_DIR)) {
    app.use(express.static(CLIENT_DIST_DIR, { index: 'index.html', fallthrough: true }))
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next()
      res.sendFile(path.join(CLIENT_DIST_DIR, 'index.html'), (err) => {
        if (err) {
          // no build yet — point the user at the README instead of confusing HTML
          res
            .status(503)
            .type('html')
            .send(
              `<!doctype html><html><head><meta charset="utf-8"><title>TuneDrop server</title></head>` +
              `<body style="font-family: system-ui, sans-serif; background:#16130F; color:#EDE6D8; display:grid; place-items:center; height:100vh; text-align:center">` +
              `<div><strong>TuneDrop</strong> API is running, but the web client is not built yet.` +
              `<br>Run <code style="color:#F2A33C">npm run build</code> then restart.</div></body></html>`,
            )
        }
      })
    })
  } else {
    app.use((req, res) => {
      res
        .status(503)
        .type('html')
        .send(
          `<!doctype html><html><head><meta charset="utf-8"><title>TuneDrop server</title></head>` +
          `<body style="font-family: system-ui, sans-serif; background:#16130F; color:#EDE6D8; display:grid; place-items:center; height:100vh; text-align:center">` +
          `<div><strong>TuneDrop</strong> API is running, but the web client is not built yet.` +
          `<br>Run <code style="color:#F2A33C">npm run build</code> then restart.</div></body></html>`,
        )
    })
  }

  /* error mapping — everything becomes { error: { code, message } } */
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = pickStatus(err)

    if (status >= 500) {
      console.error(`[http] ${req.method} ${req.path} → ${status}`, err)
    }

    if (res.headersSent) {
      res.destroy()
      return
    }
    res.status(status).json({
      error: {
        code: err?.code ?? 'INTERNAL',
        message: err?.message ?? 'Something went wrong on the server.',
      },
    })
  })

  return app
}

/** file extension → content-type, for the embedded static assets */
function mimeFor(name) {
  if (name.endsWith('.html')) return 'html'
  if (name.endsWith('.css')) return 'text/css'
  if (name.endsWith('.mjs') || name.endsWith('.js')) return 'text/javascript'
  if (name.endsWith('.svg')) return 'image/svg+xml'
  if (name.endsWith('.json')) return 'application/json'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.ico')) return 'image/x-icon'
  if (name.endsWith('.woff2')) return 'font/woff2'
  if (name.endsWith('.txt')) return 'text/plain'
  return 'application/octet-stream'
}

/** express error shape → 4xx–5xx status, mirroring the ApiErrors thrown in handlers */
function pickStatus(err) {
  switch (err?.name) {
    case 'PayloadTooLargeError': return 413
    case 'MulterError': return err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    default: break
  }
  switch (err?.type) {
    case 'entity.too.large': return 413
    case 'entity.parse.failed': return 400
    default: break
  }
  if (Number.isInteger(err?.status) && err.status >= 400 && err.status <= 599) return err.status
  return 500
}

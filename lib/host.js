/**
 * dsh-model-icons — host implementation.
 *
 * This file is loaded, and reloaded, by the package's stable entry
 * (`lib/index.js`; `lib/live.js` is a byte-identical copy of it). Everything a
 * reload replaces lives here: the loopback routes, the catalog mirror and the
 * logo cache. Nothing in this file uses `ctx.effect`, so a reload is a clean
 * dispose-and-start rather than an accumulating pile of fibers.
 *
 * What it is for: the browser half draws one monochrome vendor mark per model
 * row in the model picker, and it must not reach the internet to do it — the
 * page's own egress is exactly what this profile cannot rely on. So this half
 * mirrors two public things from the provider's site to loopback:
 *
 *   - the model catalog, which the site embeds as JSON in its own pages
 *     (`<script id="rustvy-catalog">`): model id → display name, vendor and the
 *     logo file name that vendor uses;
 *   - the logo files themselves (`/logos/<name>.svg`), copied into this profile's
 *     cache directory on first use and served from there afterwards.
 *
 * Both are read on the process's own outbound route (`./net.js`), so a proxy
 * installed by another plugin — or named in the environment — is followed, and
 * both are cached on disk, so the picker still has its marks when the origin is
 * unreachable.
 *
 * @module dsh-model-icons/host
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Build marker surfaced by `/state`; bump it to watch a reload land. */
export const build = 'icons-1'

/**
 * The revision this copy was loaded under, forwarded to the relative import so
 * Node's URL-keyed module cache hands a reload a fresh module graph.
 */
const REVISION = new URL(import.meta.url).searchParams.get('rev') ?? '0'

const NET = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'net.js')).href
const { getUrl, proxyForTarget } = await import(`${NET}?rev=${REVISION}`)

/** Loader-facing plugin name. */
export const name = 'dsh-model-icons'

/** Base path of every route this half registers. */
const PREFIX = '/dsh-model-icons'

/**
 * The pages that carry the embedded catalog, in the order they are tried. The
 * public page comes first: it needs no session, and it is the one the site keeps
 * stable for readers who are not signed in.
 */
const CATALOG_PAGES = ['/models', '/dashboard/models', '/pricing']

/** How long a cached catalog is considered current, in milliseconds. */
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000

/**
 * How long a *cold* catalog read may hold the answer, in milliseconds. Past
 * this the route answers with an empty mirror and the browser half falls back to
 * its vendor rules, which resolve a model the mirror has never seen.
 */
const COLD_WAIT_MS = 6000

/** One request budget for the origin, in milliseconds. */
const ORIGIN_TIMEOUT_MS = 25_000

/** Largest accepted logo; the site's marks are a few hundred bytes to a few KiB. */
const MAX_LOGO_BYTES = 512 * 1024

/** A logo file name this half is willing to fetch, cache and serve. */
const LOGO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.svg$/u

/** Default settings, overridable per profile and by the environment. */
const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  origin: 'https://rustvy.xyz',
  size: 16,
  markTrigger: true,
  hideOtherMarks: true,
})

/** Environment overrides, so a deployment can point the mirror elsewhere. */
const ENV_ORIGIN = 'DSH_MODEL_ICONS_ORIGIN'

/** Environment switch that keeps the plugin mounted but inert. */
const ENV_DISABLED = 'DSH_MODEL_ICONS_DISABLED'

/** The harness home directory, as the launcher publishes it. */
function homeDir() {
  return process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.cwd(), '.dsh')
}

/** This profile's directory, as the launcher publishes it. */
function profileDir() {
  return process.env.DSH_PROFILE_DIR ?? join(homeDir(), 'profiles', process.env.DSH_PROFILE ?? 'desktop')
}

/** Where this plugin's cache and settings live. */
function stateDir() {
  return join(profileDir(), '.dsh-model-icons')
}

/** The mirrored catalog. */
function catalogFile() {
  return join(stateDir(), 'catalog.json')
}

/** The mirrored logo set. */
function logosDir() {
  return join(stateDir(), 'logos')
}

/** The user's own settings for this plugin. */
function configFile() {
  return join(stateDir(), 'config.json')
}

/** Log through the loader when it offers a logger, and the console otherwise. */
function log(ctx, level, message, error) {
  const logger = typeof ctx?.logger === 'function' ? ctx.logger(name) : ctx?.logger
  const sink = logger?.[level]
  if (typeof sink === 'function') sink.call(logger, message, ...(error === undefined ? [] : [error]))
  else if (level === 'warn' || level === 'error') console.error(`[${name}] ${message}`, error ?? '')
  else console.log(`[${name}] ${message}`)
}

/**
 * Write a file atomically: a half-written cache file would otherwise leave the
 * next launch reading a truncated document.
 *
 * @param file - the destination path.
 * @param data - the bytes or text to write.
 */
function writeFileAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temporary, data)
  renameSync(temporary, file)
}

/**
 * Read a JSON file, tolerating absence and corruption.
 * @param file - the path to read.
 * @returns the parsed value, or `undefined`.
 */
function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * The settings in force: the stored ones, over the defaults, over the
 * environment. The environment wins so a deployment can repoint or silence the
 * mirror without editing a profile file.
 *
 * @returns `{ enabled, origin, size, markTrigger, hideOtherMarks }`.
 */
function readConfig() {
  const stored = readJsonFile(configFile())
  const merged = { ...DEFAULT_CONFIG }
  if (typeof stored === 'object' && stored !== null) {
    if (typeof stored.enabled === 'boolean') merged.enabled = stored.enabled
    if (typeof stored.origin === 'string' && /^https?:\/\//iu.test(stored.origin)) merged.origin = stored.origin
    if (Number.isFinite(stored.size)) merged.size = Math.min(32, Math.max(10, Math.round(stored.size)))
    if (typeof stored.markTrigger === 'boolean') merged.markTrigger = stored.markTrigger
    if (typeof stored.hideOtherMarks === 'boolean') merged.hideOtherMarks = stored.hideOtherMarks
  }
  const origin = process.env[ENV_ORIGIN]
  if (typeof origin === 'string' && /^https?:\/\//iu.test(origin.trim())) merged.origin = origin.trim()
  const disabled = process.env[ENV_DISABLED]
  if (disabled === '1' || disabled === 'true') merged.enabled = false
  merged.origin = merged.origin.replace(/\/+$/u, '')
  return merged
}

/**
 * Persist the user-editable part of the settings.
 * @param patch - the fields to change.
 * @returns the settings in force after the write.
 */
function writeConfig(patch) {
  const current = readConfig()
  const next = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    origin: typeof patch.origin === 'string' && /^https?:\/\//iu.test(patch.origin.trim())
      ? patch.origin.trim().replace(/\/+$/u, '')
      : DEFAULT_CONFIG.origin,
    size: Number.isFinite(patch.size) ? Math.min(32, Math.max(10, Math.round(patch.size))) : current.size,
    markTrigger: typeof patch.markTrigger === 'boolean' ? patch.markTrigger : current.markTrigger,
    hideOtherMarks: typeof patch.hideOtherMarks === 'boolean' ? patch.hideOtherMarks : current.hideOtherMarks,
  }
  writeFileAtomic(configFile(), `${JSON.stringify(next, null, 2)}\n`)
  return readConfig()
}

/**
 * Pull the embedded catalog document out of one of the site's pages.
 *
 * The site renders its model table from a JSON island in the page itself, which
 * is why an unauthenticated reader can be handed the same data the dashboard
 * shows. The island's attributes are matched loosely: the site is free to add
 * one, and the payload is what matters.
 *
 * @param html - the page text.
 * @returns the parsed catalog, or `undefined` when the page carries none.
 */
function parseCatalogIsland(html) {
  const match = /<script[^>]*\bid=["']?rustvy-catalog["']?[^>]*>([\s\S]*?)<\/script>/iu.exec(html)
  if (match === null) return undefined
  try {
    const parsed = JSON.parse(match[1])
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed.records)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

/**
 * Reduce one raw catalog record to the fields the picker needs.
 * @param record - the record as the site publishes it.
 * @returns the mirrored record, or `undefined` when it is unusable.
 */
function mirrorRecord(record) {
  if (typeof record !== 'object' || record === null) return undefined
  const id = typeof record.id === 'string' ? record.id.trim() : ''
  if (id === '') return undefined
  const icon = typeof record.icon === 'string' && LOGO_NAME.test(record.icon.trim()) ? record.icon.trim() : ''
  return {
    id,
    displayName: typeof record.displayName === 'string' ? record.displayName : id,
    vendor: typeof record.vendor === 'string' ? record.vendor : '',
    vendorLabel: typeof record.vendorLabel === 'string' ? record.vendorLabel : '',
    icon,
    zone: typeof record.zone === 'string' ? record.zone : '',
    hot: record.hot === true,
    free: record.free === true,
    enabled: record.enabled !== false,
  }
}

/**
 * The mirror's own state: what is cached, how old it is, and what went wrong
 * last. Reported by `/state` and carried along with `/catalog.json`.
 *
 * `lastError` is reserved for the catalog: a logo the origin does not have is an
 * ordinary answer (that vendor's rows fall back to a monogram), not a fault of
 * the mirror, and mixing the two would put a permanent red line on a healthy
 * status page.
 */
const mirror = {
  version: null,
  fetchedAt: null,
  count: 0,
  logos: 0,
  lastError: null,
  lastRoute: null,
  refreshing: false,
  /** Logo names the origin answered 404 for, so a retry is not pointless. */
  absent: new Set(),
  /** Logo names whose fetch really failed, with the reason, for the status page. */
  failures: new Map(),
}

/** In-memory catalog, so a route answer never re-reads the disk. */
let catalog = null

/** In-flight dedupe: one refresh and one fetch per logo at a time. */
let refreshInFlight = null
const logoInFlight = new Map()

/**
 * Load the cached catalog into memory.
 * @returns the cached catalog, or `undefined` when there is none.
 */
function loadCachedCatalog() {
  const stored = readJsonFile(catalogFile())
  if (typeof stored !== 'object' || stored === null || !Array.isArray(stored.records)) {
    catalog = null
    return undefined
  }
  catalog = stored
  mirror.version = stored.version ?? null
  mirror.fetchedAt = typeof stored.fetchedAt === 'string' ? stored.fetchedAt : null
  mirror.count = stored.records.length
  return catalog
}

/**
 * Count the cached logo files, for the status line.
 * @returns how many `.svg` files the cache holds.
 */
function countCachedLogos() {
  try {
    return readdirSync(logosDir()).filter(entry => entry.toLowerCase().endsWith('.svg')).length
  } catch {
    return 0
  }
}

/**
 * Read one logo from the cache.
 * @param logo - a validated file name.
 * @returns the bytes, or `undefined` when the file is absent or unreadable.
 */
function readCachedLogo(logo) {
  const file = join(logosDir(), logo)
  try {
    return statSync(file).isFile() ? readFileSync(file) : undefined
  } catch {
    return undefined
  }
}

/**
 * Decide whether cached bytes really are an SVG document. The origin answers a
 * missing file with its HTML shell, so the content type alone is not enough.
 *
 * @param status - the response status.
 * @param headers - the response headers.
 * @param body - the response bytes.
 * @returns true when the body may be cached as a logo.
 */
function isSvgDocument(status, headers, body) {
  if (status !== 200 || body.length === 0 || body.length > MAX_LOGO_BYTES) return false
  const type = String(headers['content-type'] ?? headers.get?.('content-type') ?? '')
  // Only the *leading* byte-order mark and whitespace are trimmed: some marks
  // start with an XML declaration, and a global whitespace strip would weld
  // `<?xml …?><svg …>` into a string the shape test below cannot read.
  const head = body.subarray(0, 512).toString('utf8').replace(/^\uFEFF/u, '').trimStart()
  const looksLikeSvg = head.startsWith('<svg') || (head.startsWith('<?xml') && /<svg[\s>]/u.test(head))
  return looksLikeSvg && (type === '' || /svg|xml|octet-stream|text\//iu.test(type))
}

/**
 * Fetch one logo from the origin and cache it.
 *
 * @param ctx - the plugin context, for logging.
 * @param logo - a validated file name, `something.svg`.
 * @param config - the settings in force, for the origin.
 * @param options - `{ force: true }` retries a name the origin already answered
 *   404 for.
 * @returns a promise of the cached bytes, or `undefined` when the origin does
 *   not have that logo.
 */
async function fetchLogo(ctx, logo, config, options = {}) {
  const cached = readCachedLogo(logo)
  if (cached !== undefined) return cached
  if (options.force !== true && mirror.absent.has(logo)) return undefined
  const pending = logoInFlight.get(logo)
  if (pending !== undefined) return pending
  const task = (async () => {
    const url = `${config.origin}/logos/${logo}`
    try {
      const result = await getUrl(url, { timeoutMs: ORIGIN_TIMEOUT_MS })
      mirror.lastRoute = result.via
      if (result.status === 404) {
        // An ordinary answer: the site has no mark for that vendor. Remembered so
        // a page that asks for it a hundred times does not fetch a hundred times.
        mirror.absent.add(logo)
        mirror.failures.delete(logo)
        return undefined
      }
      if (!isSvgDocument(result.status, result.headers, result.body)) {
        mirror.failures.set(logo, `HTTP ${result.status}, the answer is not an SVG document`)
        return undefined
      }
      writeFileAtomic(join(logosDir(), logo), result.body)
      mirror.absent.delete(logo)
      mirror.failures.delete(logo)
      mirror.logos = countCachedLogos()
      return result.body
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      mirror.failures.set(logo, message)
      log(ctx, 'warn', `не удалось получить ${logo} с ${config.origin}`, error)
      return undefined
    } finally {
      logoInFlight.delete(logo)
    }
  })()
  logoInFlight.set(logo, task)
  return task
}

/**
 * Fetch the catalog from the origin, cache it, and make sure every logo the
 * catalog names is cached too — so the picker's first open does not turn into a
 * burst of origin requests from the browser half.
 *
 * @param ctx - the plugin context, for logging.
 * @param config - the settings in force.
 * @returns a promise of the mirrored catalog, or `undefined` on failure.
 */
async function refreshCatalog(ctx, config) {
  if (refreshInFlight !== null) return refreshInFlight
  mirror.refreshing = true
  // A refresh is the user's way of saying "try again", so both the negative
  // caches go: a vendor the site did not have a mark for yesterday may have one
  // today.
  mirror.absent.clear()
  mirror.failures.clear()
  refreshInFlight = (async () => {
    try {
      let document = null
      let pageUsed = ''
      let lastFailure = ''
      for (const page of CATALOG_PAGES) {
        const url = `${config.origin}${page}`
        try {
          const result = await getUrl(url, { timeoutMs: ORIGIN_TIMEOUT_MS, headers: { accept: 'text/html' } })
          if (result.status !== 200) {
            lastFailure = `${page}: HTTP ${result.status}`
            continue
          }
          const parsed = parseCatalogIsland(result.body.toString('utf8'))
          if (parsed === undefined) {
            lastFailure = `${page}: no catalog island in the page`
            continue
          }
          document = parsed
          pageUsed = page
          mirror.lastRoute = result.via
          break
        } catch (error) {
          lastFailure = `${page}: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      if (document === null) {
        mirror.lastError = `каталог не получен (${lastFailure})`
        log(ctx, 'warn', `catalog refresh failed: ${lastFailure}`)
        return catalog ?? undefined
      }

      const records = document.records.map(mirrorRecord).filter(record => record !== undefined)
      const payload = {
        version: Number.isFinite(document.version) ? document.version : null,
        origin: config.origin,
        page: pageUsed,
        fetchedAt: new Date().toISOString(),
        via: mirror.lastRoute,
        records,
      }
      writeFileAtomic(catalogFile(), `${JSON.stringify(payload, null, 2)}\n`)
      catalog = payload
      mirror.version = payload.version
      mirror.fetchedAt = payload.fetchedAt
      mirror.count = records.length
      mirror.lastError = null

      // Warm the logo set the catalog names; a missing one is not a failure of
      // the refresh, it just stays absent until the next attempt.
      const logos = [...new Set(records.map(record => record.icon).filter(icon => icon !== ''))]
      await Promise.all(logos.map(logo => fetchLogo(ctx, logo, config)))
      mirror.logos = countCachedLogos()
      log(ctx, 'info', `каталог моделей обновлён: версия ${payload.version ?? '?'}, ${records.length} моделей, ${mirror.logos} иконок (${config.origin}${pageUsed})`)
      return payload
    } finally {
      mirror.refreshing = false
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

/**
 * The catalog the routes answer with: the memory copy, or the cache loaded from
 * disk. A cold cache is worth waiting for — briefly — because the first answer
 * is what the picker draws from; a merely stale one refreshes in the background
 * and the rows keep the marks they already have.
 *
 * @param ctx - the plugin context.
 * @param config - the settings in force.
 * @param options - `{ force: true }` refreshes before answering, without a bound.
 * @returns a promise of the payload the client renders.
 */
async function catalogPayload(ctx, config, options = {}) {
  if (catalog === null) loadCachedCatalog()
  const age = mirror.fetchedAt === null ? Number.POSITIVE_INFINITY : Date.now() - Date.parse(mirror.fetchedAt)
  if (options.force === true) {
    await refreshCatalog(ctx, config)
  } else if (catalog === null) {
    // Bounded: an unreachable origin must not hang the page, and the client's
    // vendor rules still resolve a model the mirror has never seen.
    await Promise.race([
      refreshCatalog(ctx, config),
      new Promise(resolve => { setTimeout(resolve, COLD_WAIT_MS) }),
    ])
  } else if (age > CATALOG_TTL_MS) {
    void refreshCatalog(ctx, config).catch(() => {})
  }
  mirror.logos = countCachedLogos()
  return {
    ok: true,
    enabled: config.enabled,
    config: { size: config.size, markTrigger: config.markTrigger, hideOtherMarks: config.hideOtherMarks, origin: config.origin },
    version: mirror.version,
    fetchedAt: mirror.fetchedAt,
    refreshing: mirror.refreshing,
    count: catalog?.records.length ?? 0,
    logos: mirror.logos,
    records: catalog?.records ?? [],
    ...mirror.lastError === null ? {} : { error: mirror.lastError },
  }
}

/** Answer one request with JSON and no caching. */
function sendJson(response, status, payload) {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    'cache-control': 'no-store',
  })
  response.end(body)
}

/** Refuse any method outside the given list. */
function methodRefused(request, response, methods) {
  if (request.method !== undefined && methods.includes(request.method)) return false
  response.writeHead(405, { allow: methods.join(', ') })
  response.end()
  return true
}

/**
 * Only this machine may read the mirror: these routes are plugin registrations
 * on the bare web server, so the host's own request fence never sees them and
 * this check stands in for it. The catalog carries no secrets, but a route that
 * answers a remote peer with locally fetched bytes is a proxy, and this plugin
 * is not one.
 *
 * @param request - the incoming request.
 * @returns an HTTP status to refuse with, or `undefined` to admit the request.
 */
function refusalOf(request) {
  const address = String(request.socket?.remoteAddress ?? '')
  const plain = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address
  const loopback = plain === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(plain)
  if (!loopback) return 403
  const host = request.headers.host
  if (host !== undefined) {
    if (!URL.canParse(`http://${host}`)) return 403
    const hostname = new URL(`http://${host}`).hostname
    if (hostname !== 'localhost' && hostname !== '[::1]' && !/^127\.\d+\.\d+\.\d+$/u.test(hostname)) return 403
  }
  const site = request.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return 403
  const origin = request.headers.origin
  if (origin === undefined) return undefined
  if (!URL.canParse(origin)) return 403
  return new URL(origin).host === host ? undefined : 403
}

/**
 * Mount the mirror's routes, warm the cache, and hand back the disposer.
 *
 * Routes are registered before any network work so a duplicate registration —
 * another revision of this plugin still holding the seat — fails here rather
 * than after a fetch has been started.
 *
 * @param ctx - a context that already has the web server.
 * @param options - `{ reload }`, invoked by the status page's reload button.
 * @returns `{ dispose }`, awaited by the stable entry on reload and unload.
 */
export async function start(ctx, options = {}) {
  const reload = typeof options.reload === 'function' ? options.reload : () => {}
  const server = ctx.webServer
  if (server === null || server === undefined || typeof server.register !== 'function') {
    throw new Error('the host carries no webServer service, so this plugin has nowhere to serve its mirror')
  }

  loadCachedCatalog()
  mirror.logos = countCachedLogos()

  const disposers = []
  const register = route => {
    try {
      const dispose = server.register(route)
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch (error) {
      log(ctx, 'error', 'маршрут не зарегистрировался', error)
      throw error
    }
  }

  register({
    kind: 'prefix',
    path: PREFIX,
    handler: (request, response) => {
      const refused = refusalOf(request)
      if (refused !== undefined) {
        sendJson(response, refused, { ok: false, error: refused === 401 ? 'unauthorized' : 'forbidden' })
        return
      }
      const sub = new URL(request.url ?? '/', 'http://local').pathname.slice(PREFIX.length)
      const config = readConfig()

      if (sub === '/catalog.json') {
        if (methodRefused(request, response, ['GET', 'HEAD'])) return
        void catalogPayload(ctx, config).then(
          payload => { sendJson(response, 200, payload) },
          error => { sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }) },
        )
        return
      }

      if (sub === '/state') {
        if (methodRefused(request, response, ['GET', 'HEAD'])) return
        sendJson(response, 200, {
          ok: true,
          build,
          revision: REVISION,
          config,
          version: mirror.version,
          fetchedAt: mirror.fetchedAt,
          refreshing: mirror.refreshing,
          models: catalog?.records.length ?? 0,
          logos: countCachedLogos(),
          route: mirror.lastRoute,
          proxy: proxyForTarget(new URL(config.origin))?.href.replace(/\/\/[^@/]+@/u, '//***@') ?? 'none',
          cacheDir: stateDir(),
          node: process.version,
          absentLogos: [...mirror.absent],
          logoFailures: Object.fromEntries(mirror.failures),
          ...mirror.lastError === null ? {} : { error: mirror.lastError },
        })
        return
      }

      if (sub === '/refresh' || sub === '/config') {
        if (methodRefused(request, response, ['POST'])) return
        const chunks = []
        let size = 0
        request.on('data', chunk => {
          size += chunk.length
          if (size > 4096) request.destroy()
          else chunks.push(chunk)
        })
        request.once('end', () => {
          let body = {}
          try {
            const text = Buffer.concat(chunks).toString('utf8').trim()
            body = text === '' ? {} : JSON.parse(text)
          } catch {
            sendJson(response, 400, { ok: false, error: 'the request body is not JSON' })
            return
          }
          const apply = async () => {
            // `/config` only writes settings: a toggle must not turn into a round
            // trip to the origin. `/refresh` is the one that fetches.
            if (sub === '/config') {
              writeConfig(body)
              return catalogPayload(ctx, readConfig())
            }
            const next = readConfig()
            await refreshCatalog(ctx, next)
            return catalogPayload(ctx, next)
          }
          void apply().then(
            payload => { sendJson(response, 200, payload) },
            error => { sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }) },
          )
        })
        request.once('error', () => {
          if (!response.headersSent) sendJson(response, 400, { ok: false, error: 'the request body could not be read' })
        })
        return
      }

      if (sub.startsWith('/logo/')) {
        if (methodRefused(request, response, ['GET', 'HEAD'])) return
        const logo = decodeURIComponent(sub.slice('/logo/'.length))
        // The name is matched against one strict shape and never joined with a
        // caller-controlled path, so the cache directory is the whole reachable
        // filesystem for this route.
        if (!LOGO_NAME.test(logo) || logo.includes('..')) {
          response.writeHead(400, { 'cache-control': 'no-store' })
          response.end()
          return
        }
        const answer = async () => {
          const bytes = readCachedLogo(logo) ?? await fetchLogo(ctx, logo, config)
          if (bytes === undefined) {
            response.writeHead(404, { 'cache-control': 'no-store' })
            response.end()
            return
          }
          response.writeHead(200, {
            'content-type': 'image/svg+xml; charset=utf-8',
            'content-length': String(bytes.byteLength),
            // The name is not content-hashed, so this is a short-lived cache: a
            // changed mark at the origin arrives within a day, and the browser
            // revalidates on the way.
            'cache-control': 'public, max-age=3600',
          })
          response.end(request.method === 'HEAD' ? undefined : bytes)
        }
        void answer().catch(error => {
          log(ctx, 'warn', `не удалось отдать ${logo}`, error)
          if (!response.headersSent) {
            response.writeHead(500, { 'cache-control': 'no-store' })
            response.end()
          }
        })
        return
      }

      response.writeHead(404, { 'cache-control': 'no-store' })
      response.end()
    },
  })

  // Warm the mirror once at mount, without holding the mount on the network: a
  // stale or empty cache refreshes in the background, and the picker draws its
  // marks from whatever the cache already holds.
  const config = readConfig()
  if (config.enabled) {
    const age = mirror.fetchedAt === null ? Number.POSITIVE_INFINITY : Date.now() - Date.parse(mirror.fetchedAt)
    if (catalog === null || age > CATALOG_TTL_MS) void refreshCatalog(ctx, config).catch(() => {})
  } else {
    log(ctx, 'info', 'иконки моделей выключены настройкой плагина')
  }
  log(ctx, 'info', `host-половина загружена: ревизия ${REVISION}, сборка ${build}, каталог ${mirror.count} моделей, ${mirror.logos} иконок`)

  let disposed = false
  return {
    dispose: async () => {
      if (disposed) return
      disposed = true
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // A route already gone is not a failure to unload.
        }
      }
      for (const task of logoInFlight.values()) void task.catch(() => {})
      logoInFlight.clear()
      if (existsSync(stateDir())) mirror.logos = countCachedLogos()
    },
  }
}

/**
 * Host half of dsh-glass-shell.
 *
 * The client half keeps everything in the browser's localStorage, which does not
 * travel with the plugin folder. This half mirrors that state into
 * `store.json` next to this file, so copying/zipping the plugin folder carries the
 * current background, gradient, recent colours and saved palettes to another
 * machine. It also serves that file over a small same-origin route:
 *
 *   GET  /dsh-glass-shell/store.json   -> current snapshot (or an empty one)
 *   POST /dsh-glass-shell/store.json   -> replace the snapshot
 *
 * There is no dependency on Harness internals beyond `ctx.webServer`.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-glass-shell'
export const inject = ['webServer']

const PREFIX = '/dsh-glass-shell'
const STORE_ROUTE = `${PREFIX}/store.json`
const STORE_FILE = fileURLToPath(new URL('./store.json', import.meta.url))
/** 8 MB: enough for one compressed wallpaper plus a long palette history. */
const MAX_BODY = 8 * 1024 * 1024

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-length': String(Buffer.byteLength(body)),
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) return { tooLarge: true }
    chunks.push(chunk)
  }
  try {
    return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { invalid: true }
  }
}

async function handleRead(res) {
  try {
    const text = await readFile(STORE_FILE, 'utf8')
    const value = JSON.parse(text)
    sendJson(res, 200, value)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      sendJson(res, 200, { version: 1, savedAt: 0, empty: true })
      return
    }
    sendJson(res, 500, { ok: false, message: String((error && error.message) || error) })
  }
}

async function handleWrite(req, res) {
  const body = await readJson(req)
  if (body.tooLarge) { sendJson(res, 413, { ok: false, message: 'snapshot too large' }); return }
  if (body.invalid || !body.value || typeof body.value !== 'object') {
    sendJson(res, 400, { ok: false, message: 'invalid json' })
    return
  }

  const payload = Object.assign({}, body.value, { savedAt: Date.now() })
  const temporary = `${STORE_FILE}.tmp`
  try {
    await mkdir(dirname(STORE_FILE), { recursive: true })
    await writeFile(temporary, JSON.stringify(payload), 'utf8')
    await rename(temporary, STORE_FILE)
    sendJson(res, 200, { ok: true, savedAt: payload.savedAt, bytes: Buffer.byteLength(JSON.stringify(payload)) })
  } catch (error) {
    sendJson(res, 500, { ok: false, message: String((error && error.message) || error) })
  }
}

async function handler(req, res) {
  let pathname = PREFIX
  try {
    pathname = new URL(req.url || STORE_ROUTE, 'http://dsh.local').pathname
  } catch {
    sendJson(res, 400, { ok: false })
    return
  }

  if (pathname !== PREFIX && pathname !== `${PREFIX}/` && pathname !== STORE_ROUTE) {
    sendJson(res, 404, { ok: false })
    return
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (req.method === 'HEAD') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(); return }
    await handleRead(res)
    return
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    await handleWrite(req, res)
    return
  }

  res.writeHead(405, { allow: 'GET, HEAD, POST, PUT' })
  res.end()
}

export function apply(ctx) {
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }),
    'dsh-glass-shell: store route',
  )
}

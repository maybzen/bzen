/**
 * smoke-render 실행기 (jsdom + react-dom/client).
 *
 * 브라우저 창 없이 실제 DOM 에 페이지를 마운트해 컴포넌트 오류를 잡아냅니다.
 * 이펙트까지 실행되므로 데이터 로딩 경로도 함께 점검됩니다.
 * fetch(Supabase)는 빈 결과로 stub 하여 네트워크 없이 결정적으로 돌립니다.
 *
 *   node scripts/run-smoke.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/* ---------- .env ---------- */
const env = {}
for (const file of ['.env', '.env.production', '.env.local']) {
  const p = join(ROOT, file)
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
  }
}
const viteEnv = {
  VITE_SUPABASE_URL: env.VITE_SUPABASE_URL || 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: env.VITE_SUPABASE_ANON_KEY || 'test-anon-key',
}

/* ---------- jsdom ---------- */
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
const { window } = dom
for (const key of [
  'window', 'document', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'HTMLElement', 'Element', 'Node', 'CustomEvent', 'Event', 'KeyboardEvent', 'MouseEvent',
  'getComputedStyle', 'DOMParser', 'SVGElement', 'MutationObserver', 'IntersectionObserver',
  'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia', 'Image',
  'File', 'FileReader', 'Blob', 'URL', 'FormData', 'Headers', 'Request', 'Response',
]) {
  const v = window[key]
  if (v !== undefined) {
    try {
      globalThis[key] = v
    } catch {
      /* 읽기 전용 */
    }
  }
}
globalThis.window = window
globalThis.document = window.document
globalThis.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
window.scrollTo = () => {}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

class RO {
  constructor(cb) { this.cb = cb }
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = RO
window.ResizeObserver = RO

/* ---------- fetch stub ---------- */
const NET = []
function jsonResponse(body, status = 200) {
  const text = JSON.stringify(body)
  const range = Array.isArray(body) ? `0-${Math.max(0, body.length - 1)}/${body.length}` : '0-0/1'
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k) => {
        const key = String(k || '').toLowerCase()
        if (key === 'content-type') return 'application/json'
        if (key === 'content-range') return range
        return null
      },
    },
    json: async () => body,
    text: async () => text,
    clone() { return this },
  }
}
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || String(input)
  NET.push(url)
  // PostgREST 목록 → 빈 배열
  if (/\/rest\/v1\//.test(url)) {
    if (/\/auth\//.test(url)) return jsonResponse({ user: null, session: null })
    if (/\/rpc\//.test(url)) return jsonResponse([])
    return jsonResponse([])
  }
  if (/storage|upload/i.test(url)) return jsonResponse({ Key: 'stub', path: 'stub' })
  return jsonResponse({}, 200)
}
window.fetch = globalThis.fetch

/* ---------- 번들 ---------- */
const outDir = mkdtempSync(join(tmpdir(), 'bzen-smoke-'))
const outFile = join(outDir, 'smoke.mjs')

/* Windows에서는 확장자 없는 esbuild 스크립트를 직접 spawn할 수 없어 node로 실행합니다 */
const ESBUILD_BIN = join(ROOT, 'node_modules/esbuild/bin/esbuild')
const ESBUILD_CMD = process.platform === 'win32' ? process.execPath : ESBUILD_BIN
const esbuildArgs = (args) => (process.platform === 'win32' ? [ESBUILD_BIN, ...args] : args)

execFileSync(
  ESBUILD_CMD,
  esbuildArgs([
    join(ROOT, 'scripts/smoke-render.jsx'),
    '--bundle',
    '--platform=node',
    '--format=esm',
    '--jsx=automatic',
    '--loader:.js=jsx',
    '--loader:.jsx=jsx',
    `--define:import.meta.env=${JSON.stringify(viteEnv)}`,
    `--define:process.env.NODE_ENV=${JSON.stringify('development')}`,
    `--outfile=${outFile}`,
    '--banner:js=import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
    '--log-level=error',
  ]),
  { stdio: 'inherit', cwd: ROOT },
)

const mod = await import(pathToFileURL(outFile).href)
const code = typeof mod.run === 'function' ? await mod.run() : 1
process.exit(code)
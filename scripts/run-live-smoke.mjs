/**
 * 실제 DB 를 붙여 페이지 전체를 렌더하는 점검 (live smoke).
 *
 * - 로그인: SUPABASE_SECRET_KEYS(또는 SERVICE_ROLE)로 관리자 세션 흉내
 * - 데이터: 실제 장부(entries)·프로젝트·구성원·일정까지 그대로 읽어옵니다.
 *   빈 데이터로 돌면 "데이터가 있을 때 깨지는" 문제가 안 잡힙니다.
 * - 실행: node scripts/run-live-smoke.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const ROOT = new URL('..', import.meta.url).pathname

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
const SECRET = env.SUPABASE_SECRET_KEYS || env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY
const viteEnv = {
  VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: SECRET,
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
  'File', 'FileReader', 'Blob', 'URL', 'FormData', 'Headers', 'Request', 'Response', 'AbortController',
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

/* recharts 등 차트 라이브러리가 요구하는 API (jsdom 미지원) */
class RO {
  constructor(cb) { this.cb = cb }
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = RO
window.ResizeObserver = RO

/* ---------- 번들 ---------- */
const outDir = mkdtempSync(join(tmpdir(), 'bzen-live-'))
const outFile = join(outDir, 'live.mjs')

execFileSync(
  join(ROOT, 'node_modules/esbuild/bin/esbuild'),
  [
    join(ROOT, 'scripts/live-smoke.jsx'),
    '--bundle', '--platform=node', '--format=esm', '--jsx=automatic',
    '--loader:.js=jsx', '--loader:.jsx=jsx',
    `--define:import.meta.env=${JSON.stringify(viteEnv)}`,
    `--define:process.env.NODE_ENV=${JSON.stringify('development')}`,
    `--outfile=${outFile}`,
    '--banner:js=import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
    '--log-level=error',
  ],
  { stdio: 'inherit', cwd: ROOT },
)

const mod = await import(pathToFileURL(outFile).href)
process.exit(typeof mod.run === 'function' ? await mod.run() : 1)
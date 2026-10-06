/**
 * 기존 verify-*.mjs 스모크 스크립트 일괄 실행기.
 * .env 의 VITE_* 값을 주입하므로 supabase 클라이언트 생성에 실패하지 않습니다.
 *
 *   node scripts/run-verify.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

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

const outDir = mkdtempSync(join(tmpdir(), 'bzen-verify-'))
const files = readdirSync(join(ROOT, 'scripts')).filter((f) => /^verify-.*\.mjs$/.test(f)).sort()
let bad = 0

for (const file of files) {
  const out = join(outDir, basename(file))
  process.stdout.write(`\n=== ${file} ===\n`)
  try {
    execFileSync(
      join(ROOT, 'node_modules/esbuild/bin/esbuild'),
      [
        join(ROOT, 'scripts', file),
        '--bundle', '--platform=node', '--format=esm', '--loader:.js=jsx',
        `--define:import.meta.env=${JSON.stringify(viteEnv)}`,
        `--define:process.env.NODE_ENV=${JSON.stringify('development')}`,
        `--outfile=${out}`, '--log-level=error',
      ],
      { stdio: 'inherit', cwd: ROOT },
    )
  } catch {
    bad++
    console.log(`  번들 실패`)
    continue
  }
  try {
    execFileSync(process.execPath, [out], { stdio: 'inherit', cwd: ROOT })
  } catch {
    bad++
    console.log(`  ↑ 실행 실패 (위 참고)`)
  }
}

console.log(bad ? `\n실패 스크립트 ${bad}개` : '\n모든 검증 스크립트 통과')
process.exit(bad ? 1 : 0)
/**
 * TDZ(선언 전 사용) 정적 점검.
 *
 * 함수/컴포넌트 안에서 `const/let` 로 선언된 이름이
 * 선언 줄보다 앞에서 쓰였는지 대충 훑어봅니다.
 * 실제로 TDZ 오류를 냈던.visibleCount / yearFilter 패턴을 잡기 위한 도구입니다.
 *
 * 실행: node scripts/audit-tdz.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOTS = ['src']
const EXTS = new Set(['.js', '.jsx'])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (EXTS.has(extname(name))) out.push(p)
  }
  return out
}

const DECL = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/g
// 함수/컴포넌트 블록 시작 근처로 볼 구간
const BLOCK = /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?function\s+[A-Za-z_$][\w$]*|(?:^|\n)\s*(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/

let found = 0

for (const file of ROOTS.flatMap((r) => walk(r))) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  // 함수 블록 경계 대충 잡기 (들여쓰기 2칸 함수 시작부터 다음 같은 레벨 함수까지)
  const starts = []
  lines.forEach((line, i) => {
    if (/^(?:export\s+)?(?:default\s+)?function\s+[A-Za-z_$]/.test(line) || /^(?:export\s+)?const\s+[A-Za-z_$][\w$]*\s*=\s*(?:\(|async|[A-Za-z_$])/.test(line)) {
      starts.push(i)
    }
  })
  starts.push(lines.length)

  for (let s = 0; s < starts.length - 1; s++) {
    const from = starts[s]
    const to = starts[s + 1]
    const seg = lines.slice(from, to).join('\n')
    const declAt = new Map()
    DECL.lastIndex = 0
    let m
    while ((m = DECL.exec(seg))) {
      if (!declAt.has(m[1])) declAt.set(m[1], m.index)
    }
    for (const [name, idx] of declAt) {
      // 이 블록 내, 선언 위치보다 앞에서 쓰였는지
      const use = new RegExp(`(?<![.\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$:])`).exec(seg.slice(0, idx))
      if (!use) continue
      // 앞부분에 import/프로퍼시 키 같은 오탐 제거
      const prefix = seg.slice(0, idx)
      if (/^\s*(import|export)\s/.test(prefix.trimEnd().split('\n').pop() || '')) continue
      // 선언 자체 (혹시 짧은 var 후속)와 주석 제외 확인
      const upto = seg.slice(0, idx).replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
      const before = upto.replace(new RegExp(`(?<![.\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$:])`, 'g'), '')
      if (!before.includes(name)) {
        const lineNo = from + upto.slice(0, use.index).split('\n').length
        console.log(`${file}:${lineNo}  블록 "${lines[from].trim().slice(0, 60)}" 안에서 ${name} 선언 전 사용 가능성`)
        found++
      }
    }
  }
}

console.log(found ? `\n의심 ${found}건` : '\n의심 없음')
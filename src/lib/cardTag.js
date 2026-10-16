/**
 * 메모의 카드 꼬리표 읽기/쓰기 (법카 9988→2381, 카드의정석 0854).
 * 목록에서 바로 카드를 바꿀 때 씁니다. 위치는 그대로 두고 꼬리표만 갈아낍니다.
 */
import { CARD_USERS } from './constants'

const KNOWN_USER_CODES = new Set(CARD_USERS.map((u) => u.code))

export function parseCardUsers(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 메모 이용자 꼬리표에서 이용자 코드만 뽑습니다.
 *  메모에는 "Z,B,G,S,N,J 법카 9988→2381 10월 청구분…"처럼 코드 뒤에 카드 메모가
 *  붙어 있어서, 앞쪽의 코드 형태 토큰만 남기고 뒷말은 버립니다 (메모 원문은 유지). */
export function userCodesOnly(value) {
  const out = []
  const single = /^[A-Za-z0-9가-힣]+$/
  for (const chunk of parseCardUsers(value)) {
    if (single.test(chunk)) {
      out.push(chunk) // Z, ALL, SHINE 같은 단일 코드
      continue
    }
    // "J 법카 9988…"처럼 코드 뒤에 설명이 붙은 덩이는 앞쪽 코드 토큰만 살립니다
    const subs = chunk.split(/\s+/)
    for (let i = 0; i < subs.length; i += 1) {
      const sub = subs[i]
      if (!single.test(sub)) break
      if (KNOWN_USER_CODES.has(sub) || sub === 'ALL' || i === 0) out.push(sub)
      else break
    }
  }
  return [...new Set(out)]
}

export const CARD_TAG_RE = /법카\s*\d+(?:→\d+)?|카드의정석\s*[\d-]+/

export const DEFAULT_CARD_OPTIONS = ['법카 9988→2381', '법카 3918→3842', '카드의정석 0854']

/** 메모에서 카드 꼬리표를 읽습니다. 없으면 '기타' */
export function cardTagOf(memo) {
  const m = String(memo || '').match(
    /(법카\s*\d+(?:→\d+)?|카드의정석\s*[\d-]+)/,
  )
  return m ? m[1].replace(/\s+/g, ' ') : '기타'
}

const CARD_TAG_STRIP_RE =
  /\s*(?:·\s*)?(?:법카\s*\d+(?:→\d+)?|카드의정석\s*[\d-]+)/

/** 메모의 카드 꼬리표를 바꿉니다. 없으면 끝에 붙이고, 빈 값이면 지웁니다 */
export function withMemoCard(memo, label) {
  const src = String(memo || '')
  const v = String(label || '').trim()
  if (CARD_TAG_RE.test(src)) {
    if (!v) return src.replace(CARD_TAG_STRIP_RE, '').trim()
    return src.replace(CARD_TAG_RE, v)
  }
  return v ? (src ? `${src} · ${v}` : v) : src
}

/** 선택박스에는 끝 4자리만 보여줍니다 (값은 전체 보관) */
export function shortCard(label) {
  const d = String(label || '').replace(/[^0-9]/g, '')
  return d ? d.slice(-4) : label
}

/** 메모의 이용자 꼬리표 읽기/쓰기.
 *  코드 토큰만 걷어내고 뒷말(법카·청구분)은 유지합니다.
 *  구 메모("…이용자 B 법카…", · 없음)와 신 메모("… · 이용자 B · …") 둘 다 처리합니다 */
export function withMemoUser(memo, user) {
  const base = String(memo || '')
    .replace(/\s*(?:·\s*)?이용자\s+[A-Za-z0-9가-힣]+(?:\s*,\s*[A-Za-z0-9가-힣]+)*(?=[\s·]|$)/, '')
    .trim()
  const codes = userCodesOnly(user)
  return codes.length ? `${base} · 이용자 ${codes.join(',')}` : base
}

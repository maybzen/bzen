/**
 * 메모의 카드 꼬리표 읽기/쓰기 (법카 9988→2381, 카드의정석 0854).
 * 목록에서 바로 카드를 바꿀 때 씁니다. 위치는 그대로 두고 꼬리표만 갈아낍니다.
 */

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

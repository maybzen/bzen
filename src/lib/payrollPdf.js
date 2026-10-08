/**
 * 세무사무실 급여대장 PDF 읽기 (사원번호·성명 3행 블록형).
 * 텍스트 기반 PDF(드래그 선택 가능)만 됩니다. 스캔 이미지 PDF는 안 됩니다.
 * pdfjs는 PDF를 고를 때만 동적 로딩합니다 (기본 번들에 안 들어감).
 *
 * 양식 (예: 2026년09월분 급여대장):
 *   [헤더 3~4줄: 인적사항/기본급여/공제/영수인 + 사원번호 성명 기본급 ... + 입사일 직급 ... + 퇴사일 부서 ... 지급합계 ... 차인지급액]
 *   [1인 3줄]
 *     A행: 사원번호 | 성명 | 기본급 | 직책수당 | 식대 | ... (인별 수당·공제)
 *     B행: 입사일 | 직급 | ... | 공제합계
 *     C행: 퇴사일 | 부서 | ... | 지급합계 | 차인지급액   ← 마지막 숫자가 실지급액
 *   [합계 행]
 * 문서 머리의 [귀속:YYYY년MM월] [지급:YYYY년MM월DD일]에서 날짜를 읽습니다.
 */

let pdfjsPromise = null

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist')
      const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = worker
      return pdfjs
    })()
  }
  return pdfjsPromise
}

const norm = (s) => String(s || '').replace(/\s+/g, '')

const numOf = (s) => {
  const digits = String(s || '').replace(/[^0-9]/g, '')
  if (!digits) return 0
  const n = Number(digits)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/* 텍스트 조각을 줄 단위로 묶습니다 (y가 가까우면 같은 줄) */
function groupRows(items) {
  const list = Array.isArray(items) ? items : []
  const pts = []
  for (const it of list) {
    if (!it || !String(it.str || '').trim() || !Array.isArray(it.transform)) continue
    pts.push({ text: String(it.str), x: Number(it.transform[4]) || 0, y: Number(it.transform[5]) || 0 })
  }
  pts.sort((a, b) => b.y - a.y || a.x - b.x)
  const rows = []
  for (const p of pts) {
    const last = rows[rows.length - 1]
    if (last && Math.abs(last.y - p.y) <= 3) last.cells.push(p)
    else rows.push({ y: p.y, cells: [p] })
  }
  const out = []
  for (const r of rows) {
    r.cells.sort((a, b) => a.x - b.x)
    out.push(r.cells.map((c) => c.text))
  }
  return out
}

const isName = (s) => /^[가-힣]{2,5}$/.test(norm(s))
const isEmpNo = (s) => /^\d{1,6}$/.test(String(s || '').trim())
const isSumRow = (cells) => {
  const joined = norm((cells || []).join(''))
  return !joined || /합계|총계|소계/.test(joined)
}

/* 블록 첫 줄: [사원번호, 성명, ...] */
function blockName(cells) {
  if (!Array.isArray(cells) || cells.length < 2) return ''
  const first = String(cells[0] || '').trim()
  const second = String(cells[1] || '').trim()
  if (isEmpNo(first) && isName(second)) return norm(second)
  // 번호 없이 이름만 있는 변형: 첫 칸이 이름이면 인정
  if (isName(first) && !/\d/.test(first)) return norm(first)
  return ''
}

/* 블록 마지막 줄의 마지막 숫자 = 차인지급액(실지급액) */
function blockPay(cells) {
  if (!Array.isArray(cells)) return 0
  for (let i = cells.length - 1; i >= 0; i -= 1) {
    const n = numOf(cells[i])
    if (n > 0) return n
  }
  return 0
}

function docDates(allRows) {
  let attrYm = ''
  let payDate = ''
  for (const cells of allRows) {
    const t = String((cells || []).join(' '))
    let m = t.match(/귀속\s*[:：]?\s*(\d{4})\s*년\s*(\d{1,2})\s*월/)
    if (m && !attrYm) attrYm = `${m[1]}-${String(Number(m[2])).padStart(2, '0')}`
    m = t.match(/지급\s*[:：]?\s*(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
    if (m && !payDate) {
      payDate = `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
    }
    if (attrYm && payDate) break
  }
  return { attrYm, payDate }
}

/**
 * PDF ArrayBuffer → parseCSV와 같은 2차원 배열 ([['일자','성명','급여','적요','메모'], ...]).
 * 일자 열이 PDF에 없으면 문서 머리 [지급:…] → 없으면 payDate(화면 지급일)를 씁니다.
 */
export async function parsePayrollPdf(buffer, { payDate = '', ym = '' } = {}) {
  let pdfjs
  try {
    pdfjs = await loadPdfjs()
  } catch (e) {
    throw new Error(`PDF 해석기를 불러오지 못했습니다 (${e?.message || e}). 네트워크 후 다시 시도하세요.`)
  }
  let doc = null
  try {
    const data = buffer instanceof ArrayBuffer ? buffer : await Promise.resolve(buffer)
    doc = await pdfjs.getDocument({ data }).promise
    const pages = doc.numPages || 0
    const allRows = []
    for (let p = 1; p <= pages; p += 1) {
      // eslint-disable-next-line no-await-in-loop
      const page = await doc.getPage(p)
      // eslint-disable-next-line no-await-in-loop
      const content = await page.getTextContent()
      const rows = groupRows(content && content.items)
      for (const r of rows) allRows.push(r)
    }
    if (!allRows.flat().join('').trim()) {
      throw new Error('텍스트가 없는 스캔본 PDF입니다. 세무사무실에 원본(텍스트) PDF나 엑셀(CSV)을 요청해 주세요.')
    }
    const meta = docDates(allRows)
    const useYm = meta.attrYm || ym
    const useDate = meta.payDate || payDate
    const attrLabel = useYm ? `${Number(String(useYm).slice(5))}월 급여` : ''
    const out = []
    for (let i = 0; i < allRows.length; i += 1) {
      const cells = allRows[i]
      if (isSumRow(cells)) continue
      const name = blockName(cells)
      if (!name) continue
      // 블록 3번째 줄(퇴사·부서·지급합계·차인지급액 줄)에서 실지급액을 읽습니다
      const third = allRows[i + 2]
      const pay = blockPay(third) || blockPay(allRows[i + 1]) || blockPay(cells)
      if (pay <= 0) continue
      out.push([useDate, name, String(pay), attrLabel, ''])
    }
    if (!out.length) {
      throw new Error('급여 표를 찾지 못했습니다 (사원번호·성명 블록 필요). 세무사무실 양식이 다르면 엑셀(CSV)로 받아 올리세요.')
    }
    return {
      parsed: [['일자', '성명', '급여', '적요', '메모'], ...out],
      meta: { pages, people: out.length, payDate: useDate, attrYm: useYm },
    }
  } catch (e) {
    if (e && /스캔본|찾지 못했습니다/.test(String(e.message || ''))) throw e
    throw new Error(`PDF를 읽지 못했습니다 (${e?.message || e}). 텍스트 선택이 되는 원본 PDF인지 확인해 주세요.`)
  } finally {
    if (doc) {
      try {
        await doc.destroy()
      } catch {
        /* 무시 */
      }
    }
  }
}

/* 단위 테스트용 (scripts/verify-payroll-pdf.mjs) */
export const __testables = { groupRows, blockName, blockPay, docDates, numOf, norm }

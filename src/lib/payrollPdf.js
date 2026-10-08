/**
 * 세무사무실 급여대장 PDF 읽기.
 * 텍스트 기반 PDF(드래그 선택 가능)만 됩니다. 스캔 이미지 PDF는 안 됩니다.
 * pdfjs는 PDF를 고를 때만 동적 로딩합니다 (기본 번들에 안 들어감).
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

/* 텍스트 조각을 줄 단위로 묶습니다 (y가 가까우면 같은 줄) */
function groupRows(items) {
  const pts = (items || [])
    .filter((it) => it && String(it.str || '').trim() && Array.isArray(it.transform))
    .map((it) => ({ text: String(it.str), x: Number(it.transform[4]) || 0, y: Number(it.transform[5]) || 0 }))
  pts.sort((a, b) => b.y - a.y || a.x - b.x)
  const rows = []
  for (const p of pts) {
    const last = rows[rows.length - 1]
    if (last && Math.abs(last.y - p.y) <= 3) {
      last.cells.push(p)
    } else {
      rows.push({ y: p.y, cells: [p] })
    }
  }
  for (const r of rows) r.cells.sort((a, b) => a.x - b.x)
  return rows.map((r) => r.cells.map((c) => c.text))
}

const NAME_RES = [/^성\s*명$/, /^이\s*름$/, /^성명$/, /^이름$/]
const PAY_RES = [
  /차인지급액/, /실지급액/, /실수령액/, /지급합계/, /지급총액/, /공제후지급액/,
  /지급액/, /급여합계/, /급여총액/, /^급여$/,
]
const DATE_RES = [/지급일/, /급여일/, /^일자$/]
const DESC_RES = [/적요/, /^비고$/, /내역/]
const NO_NUM = /합계|총계|^계$|소계/

function isHeaderRow(cells) {
  const joined = norm(cells.join(''))
  const hasName = cells.some((c) => /성명/.test(norm(c)) || /^이름$/.test(norm(c)))
  if (!hasName) return false
  return PAY_RES.some((re) => re.test(joined)) || joined.includes('지급') || joined.includes('급여')
}

function colIndex(cells, resList) {
  for (const re of resList) {
    const i = cells.findIndex((c) => re.test(norm(c)))
    if (i >= 0) return i
  }
  return -1
}

const numOf = (s) => {
  const digits = String(s || '').replace(/[^0-9]/g, '')
  if (!digits) return 0
  const n = Number(digits)
  return Number.isFinite(n) ? Math.round(n) : 0
}

/* 단위 테스트용 (scripts/verify-payroll-pdf.mjs) */
export const __testables = { groupRows, isHeaderRow, colIndex, numOf, norm }

/**
 * PDF ArrayBuffer → parseCSV와 같은 2차원 배열 ([['일자','성명','급여','적요','메모'], ...]).
 * 일자 열이 없으면 payDate(지급일)를 넣어줍니다.
 */
export async function parsePayrollPdf(buffer, { payDate = '', ym = '' } = {}) {
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: buffer }).promise
  try {
    const out = []
    let pages = 0
    let scanned = true
    for (let p = 1; p <= doc.numPages; p += 1) {
      pages += 1
      // eslint-disable-next-line no-await-in-loop
      const content = await doc.getPage(p).then((page) => page.getTextContent())
      const rows = groupRows(content.items)
      if (rows.flat().join('').trim()) scanned = false
      const headIdx = rows.findIndex(isHeaderRow)
      if (headIdx < 0) continue
      const head = rows[headIdx]
      const nameIdx = colIndex(head, NAME_RES)
      const payIdx = colIndex(head, PAY_RES)
      if (nameIdx < 0 || payIdx < 0) continue
      const dateIdx = colIndex(head, DATE_RES)
      const descIdx = colIndex(head, DESC_RES)
      for (const cells of rows.slice(headIdx + 1)) {
        if (!cells.length) continue
        const joined = norm(cells.join(''))
        if (!joined || NO_NUM.test(joined)) continue
        if (isHeaderRow(cells)) break
        const name = norm(cells[Math.min(nameIdx, cells.length - 1)] || '')
        if (!/^[가-힣]{2,5}$/.test(name)) continue
        const pay = numOf(cells[Math.min(payIdx, cells.length - 1)])
        if (pay <= 0) continue
        const dateCell = dateIdx >= 0 ? String(cells[Math.min(dateIdx, cells.length - 1)] || '').trim() : ''
        const date = /^\d{4}-\d{2}-\d{2}$/.test(dateCell) ? dateCell : payDate
        const descCell = descIdx >= 0 ? String(cells[Math.min(descIdx, cells.length - 1)] || '').trim() : ''
        out.push([date, name, String(pay), descCell, ''])
      }
    }
    if (scanned) {
      throw new Error('텍스트가 없는 스캔본 PDF입니다. 세무사무실에 원본(텍스트) PDF나 엑셀(CSV)을 요청해 주세요.')
    }
    if (!out.length) {
      throw new Error('급여 표를 찾지 못했습니다 (성명·급여 열 필요). 세무사무실 양식이 다르면 엑셀(CSV)로 받아 올리세요.')
    }
    const attrLabel = ym ? `${Number(String(ym).slice(5))}월 급여` : ''
    return {
      parsed: [
        ['일자', '성명', '급여', '적요', '메모'],
        ...out.map(([d, n, pay, desc]) => [d, n, pay, desc || attrLabel, '']),
      ],
      meta: { pages, people: out.length },
    }
  } finally {
    try {
      await doc.destroy()
    } catch {
      /* 무시 */
    }
  }
}

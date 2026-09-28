import { useCallback, useEffect, useMemo, useState } from 'react'
import EntryFormModal from '../components/EntryFormModal'
import EntryTable from '../components/EntryTable'
import Icon from '../components/Icon'
import { AttachmentModal } from '../components/Attachments'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, LoadingBlock, Modal, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { formatKRW, monthEnd, todayISO } from '../lib/format'
import { INTERNAL_PROJECT_NAME } from '../lib/constants'
import { downloadTextFile, parseCSV, toCSV } from '../lib/csv'
import { createEntries, deleteEntry, listAttachments, listEntries, listProfiles, listProjects } from '../lib/api'

/**
 * 급여관리 (관리자 전용).
 * 월별 급여대장입니다. 장부에 인건비로 잡힌 내역을 직원별로 보여줍니다.
 * - 급여: 인건비 (4대보험 제외)
 * - 4대보험: 카테고리와 무관하게 거래처(건보·근복공단) 기준으로 분리합니다.
 *   카테고리가 월마다 인건비/세금과공과로 섞여 들어온 전례가 있어서 그렇습니다.
 * - 세금·원천징수: 세금과공과 + 메모에 원천징수가 적힌 행
 * 급여명세서 PDF는 증빙으로 붙이면 이 화면에서 바로 봅니다.
 */

const INSURANCE = ['국민건강보험공단', '근로복지공단']

export const isInsurance = (e) => INSURANCE.includes(String(e.counterparty || '').trim())
export const isSalary = (e) => e.category === '인건비' && !isInsurance(e)
export const isTaxRow = (e) =>
  !isSalary(e) &&
  !isInsurance(e) &&
  (e.category === '세금과공과' || /원천징수/.test(`${e.description || ''} ${e.memo || ''}`))

function shiftYm(ym, delta) {
  const [y, m] = String(ym).split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthRange(ym) {
  const [y, m] = String(ym).split('-').map(Number)
  return { from: `${ym}-01`, to: monthEnd(new Date(y, m - 1, 1)) }
}

const sumTotal = (rows) => (rows || []).reduce((a, e) => a + Number(e.total_amount || 0), 0)

export default function Payroll() {
  const { isAdmin, user } = useAuth()
  const toast = useToast()

  const [ym, setYm] = useState(() => todayISO().slice(0, 7))
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState([])
  const [prevEntries, setPrevEntries] = useState([])
  const [projects, setProjects] = useState([])
  const [profiles, setProfiles] = useState([])
  const [attachmentsByEntry, setAttachmentsByEntry] = useState({})

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [viewerFiles, setViewerFiles] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { from, to } = monthRange(ym)
      const prev = monthRange(shiftYm(ym, -1))
      const [cur, prv, projectRows, profileRows] = await Promise.all([
        listEntries({ from, to }),
        listEntries({ from: prev.from, to: prev.to }),
        listProjects(),
        listProfiles(),
      ])
      const pick = (rows) => (rows || []).filter((e) => isSalary(e) || isInsurance(e) || isTaxRow(e))
      const curRows = pick(cur)
      setEntries(curRows)
      setPrevEntries(pick(prv))
      setProjects(projectRows || [])
      setProfiles(profileRows || [])

      const files = await listAttachments(curRows.map((r) => r.id)).catch(() => [])
      const map = {}
      for (const file of files || []) {
        if (!map[file.entry_id]) map[file.entry_id] = []
        map[file.entry_id].push(file)
      }
      setAttachmentsByEntry(map)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [ym, toast])

  useEffect(() => {
    load()
  }, [load, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const salaryRows = useMemo(() => entries.filter(isSalary), [entries])
  const insuranceRows = useMemo(() => entries.filter(isInsurance), [entries])
  const taxRows = useMemo(() => entries.filter(isTaxRow), [entries])

  const staffNames = useMemo(
    () => new Set((profiles || []).map((p) => String(p.full_name || '').trim()).filter(Boolean)),
    [profiles],
  )
  const personKind = (name) => (staffNames.has(String(name || '').trim()) ? '내부' : '외부·단기')

  /* 단기·외부 인력은 별도 섹션에서 관리합니다 (손선욱·행사 단기인력 등) */
  const staffSalaryRows = useMemo(
    () => salaryRows.filter((e) => personKind(e.counterparty) === '내부'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salaryRows, staffNames],
  )
  const tempSalaryRows = useMemo(
    () => salaryRows.filter((e) => personKind(e.counterparty) !== '내부'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salaryRows, staffNames],
  )
  const tempTotal = useMemo(() => sumTotal(tempSalaryRows), [tempSalaryRows])
  const tempHeads = useMemo(
    () => new Set(tempSalaryRows.map((e) => String(e.counterparty || '').trim())).size,
    [tempSalaryRows],
  )
  /* 같은 월·같은 성명은 1건이 원칙. 업로드 시 중복을 걸러냅니다. */
  const existingSalaryNames = useMemo(
    () => new Set(salaryRows.map((e) => String(e.counterparty || '').trim()).filter(Boolean)),
    [salaryRows],
  )
  const internalProjectId = useMemo(
    () => (projects || []).find((p) => p.name === INTERNAL_PROJECT_NAME)?.id || null,
    [projects],
  )

  const salaryTotal = useMemo(() => sumTotal(salaryRows), [salaryRows])
  const prevSalaryTotal = useMemo(() => sumTotal(prevEntries.filter(isSalary)), [prevEntries])
  const insuranceTotal = useMemo(() => sumTotal(insuranceRows), [insuranceRows])
  const taxTotal = useMemo(() => sumTotal(taxRows), [taxRows])

  const internalCount = useMemo(
    () => new Set(staffSalaryRows.map((e) => String(e.counterparty || '').trim())).size,
    [staffSalaryRows],
  )

  const diff = salaryTotal - prevSalaryTotal
  const diffPct = prevSalaryTotal ? (diff / prevSalaryTotal) * 100 : null

  const handleDelete = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await deleteEntry(removing.id)
      toast.success('삭제되었습니다.')
      setRemoving(null)
      setReloadKey((k) => k + 1)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  const openNew = () => {
    setEditing({ category: '인건비' })
    setFormOpen(true)
  }

  const [y, m] = ym.split('-').map(Number)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="급여관리" description="월별 급여대장입니다. 급여명세서는 증빙으로 붙이면 여기서 바로 봅니다.">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setYm(shiftYm(ym, -1))} className="btn-ghost !px-2" aria-label="이전 달">
            <Icon name="chevron-left" size={16} />
          </button>
          <input
            type="month"
            className="input w-auto py-1.5 text-xs"
            value={ym}
            onChange={(e) => e.target.value && setYm(e.target.value)}
          />
          <button type="button" onClick={() => setYm(shiftYm(ym, 1))} className="btn-ghost !px-2" aria-label="다음 달">
            <Icon name="chevron-right" size={16} />
          </button>
          <button type="button" onClick={() => setYm(todayISO().slice(0, 7))} className="btn-ghost !px-2.5 text-xs">
            이번 달
          </button>
        </div>
        {isAdmin ? (
          <>
            <button type="button" className="btn-ghost" onClick={() => setImportOpen(true)}>
              <Icon name="upload" size={16} />
              급여대장 올리기
            </button>
            <button type="button" className="btn-primary" onClick={openNew}>
              <Icon name="plus" size={16} />
              급여 등록
            </button>
          </>
        ) : null}
      </PageHeader>

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard
              label={`${m}월 급여총액`}
              value={salaryTotal}
              tone="neutral"
              icon="coins"
              hint={
                diffPct === null
                  ? '전월 내역 없음'
                  : `${diff >= 0 ? '+' : ''}${formatKRW(diff)}원 (${diffPct >= 0 ? '+' : ''}${diffPct.toFixed(1)}%)`
              }
            />
            <StatCard
              label="지급 인원"
              value={String(new Set(salaryRows.map((e) => (e.counterparty || '').trim())).size)}
              unit="명"
              tone="neutral"
              icon="users"
              hint={`내부 ${internalCount}명 · 외부·단기 ${tempHeads}명(${formatKRW(tempTotal)}원)`}
            />
            <StatCard label="4대보험 회사부담" value={insuranceTotal} tone="opex" icon="receipt" hint="건보·산재" />
            <StatCard label="세금·원천징수" value={taxTotal} tone={taxTotal > 0 ? 'loss' : 'neutral'} icon="file" hint="원천세 등" />
          </div>

          <section className="card overflow-hidden">
            <header className="border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">
                직원 급여 ({staffSalaryRows.length}건)
              </h2>
              <p className="mt-0.5 text-xs text-ink-500">
                계정이 있는 내부 직원분입니다. 합계 {formatKRW(salaryTotal - tempTotal)}원
              </p>
            </header>
            {staffSalaryRows.length ? (
              <EntryTable
                entries={staffSalaryRows}
                projects={projects}
                profiles={profiles}
                attachmentsByEntry={attachmentsByEntry}
                canEdit={isAdmin}
                onEdit={(entry) => {
                  setEditing({ ...entry, attachments: attachmentsByEntry[entry.id] || [] })
                  setFormOpen(true)
                }}
                onDelete={isAdmin ? setRemoving : undefined}
                onOpenAttachments={setViewerFiles}
                canChangeAuthor={isAdmin}
              />
            ) : (
              <EmptyState icon="coins" title={`${y}년 ${m}월 급여 내역이 없습니다`} description="급여 등록이나 급여대장 올리기로 기록하세요." />
            )}
          </section>

          <section className="card overflow-hidden">
            <header className="border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">
                단기·외부 인력 ({tempSalaryRows.length}건)
              </h2>
              <p className="mt-0.5 text-xs text-ink-500">
                계정이 없는 분(손선욱·행사 단기인력 등)은 여기서 따로 관리됩니다. 합계 {formatKRW(tempTotal)}원
              </p>
            </header>
            {tempSalaryRows.length ? (
              <EntryTable
                entries={tempSalaryRows}
                projects={projects}
                profiles={profiles}
                attachmentsByEntry={attachmentsByEntry}
                canEdit={isAdmin}
                onEdit={(entry) => {
                  setEditing({ ...entry, attachments: attachmentsByEntry[entry.id] || [] })
                  setFormOpen(true)
                }}
                onDelete={isAdmin ? setRemoving : undefined}
                onOpenAttachments={setViewerFiles}
                canChangeAuthor={isAdmin}
              />
            ) : (
              <EmptyState icon="users" title="단기·외부 인력 급여가 없습니다" />
            )}
          </section>

          <section className="card overflow-hidden">
            <header className="border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">
                4대보험·세금·원천징수 ({insuranceRows.length + taxRows.length}건)
              </h2>
            </header>
            {insuranceRows.length + taxRows.length ? (
              <EntryTable
                entries={[...insuranceRows, ...taxRows]}
                projects={projects}
                profiles={profiles}
                attachmentsByEntry={attachmentsByEntry}
                canEdit={isAdmin}
                onEdit={(entry) => {
                  setEditing({ ...entry, attachments: attachmentsByEntry[entry.id] || [] })
                  setFormOpen(true)
                }}
                onDelete={isAdmin ? setRemoving : undefined}
                onOpenAttachments={setViewerFiles}
                canChangeAuthor={isAdmin}
              />
            ) : (
              <EmptyState icon="file" title="내역이 없습니다" />
            )}
          </section>
        </>
      )}

      <EntryFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        onSaved={() => setReloadKey((k) => k + 1)}
        entryType="opex"
        source="manual"
        initial={editing}
        projects={projects}
        profiles={profiles}
        isAdmin={isAdmin}
        userId={user?.id}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        busy={busy}
        title="내역을 삭제하시겠습니까?"
        message={
          removing
            ? `${removing.entry_date} · ${removing.counterparty || ''} (${formatKRW(removing.total_amount)}원)`
            : ''
        }
        onClose={() => setRemoving(null)}
        onConfirm={handleDelete}
      />

      <AttachmentModal
        open={Boolean(viewerFiles)}
        onClose={() => setViewerFiles(null)}
        attachments={viewerFiles || []}
      />

      <PayrollImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => {
          setImportOpen(false)
          setReloadKey((k) => k + 1)
        }}
        ym={ym}
        defaultProjectId={internalProjectId}
        existingNames={existingSalaryNames}
        staffNames={staffNames}
        userId={user?.id}
      />
    </div>
  )
}

/* --------------------------- 급여대장 일괄 등록 --------------------------- */

const PAYROLL_TEMPLATE = ['일자', '성명', '급여', '적요', '메모']

/**
 * 급여대장 CSV 파싱 → 장부 행 변환 (순수 함수, 검증 스크립트에서 씁니다).
 * 같은 월·같은 성명은 1건이 원칙이라 이미 등록된 성명은 건너뜁니다.
 */
export function buildPayrollRows(parsed, { existingNames = new Set(), defaultProjectId = null, userId = null } = {}) {
  const header = parsed[0].map((h) => String(h).trim())
  const indexOf = (name) => header.indexOf(name)
  const iDate = indexOf('일자')
  const iName = indexOf('성명') >= 0 ? indexOf('성명') : indexOf('거래처')
  const iPay = indexOf('급여') >= 0 ? indexOf('급여') : indexOf('공급가액')
  if (parsed.length < 2) throw new Error('데이터 행이 없습니다.')
  if (iDate < 0 || iName < 0 || iPay < 0) throw new Error('"일자" · "성명" · "급여" 열이 필요합니다.')

  const out = []
  const skipped = []
  const seen = new Set()
  for (const raw of parsed.slice(1)) {
    const date = String(raw[iDate] || '').trim().replace(/[./]/g, '-')
    const name = String(raw[iName] || '').trim()
    const pay = Number(String(raw[iPay] ?? '').replace(/[^0-9.-]/g, '')) || 0
    if (!date || !name || pay <= 0) continue
    if (existingNames.has(name) || seen.has(name)) {
      skipped.push({ entry_date: date, name, pay })
      continue
    }
    seen.add(name)
    out.push({
      entry_type: 'opex',
      source: 'manual',
      entry_date: date,
      counterparty: name,
      category: '인건비',
      description:
        indexOf('적요') >= 0 && String(raw[indexOf('적요')] || '').trim()
          ? String(raw[indexOf('적요')] || '').trim()
          : `${Number(date.slice(5, 7))}월 급여`,
      supply_amount: Math.round(pay),
      vat_amount: 0,
      memo: indexOf('메모') >= 0 ? String(raw[indexOf('메모')] || '').trim() : '',
      project_id: defaultProjectId,
      created_by: userId,
    })
  }
  return { rows: out, skipped }
}

function PayrollImportModal({ open, onClose, onDone, ym, defaultProjectId, existingNames, staffNames, userId }) {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [skipped, setSkipped] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      setRows([])
      setSkipped([])
      setError('')
    }
  }, [open ])

  const downloadTemplate = () => {
    downloadTextFile(
      '급여대장_업로드_양식.csv',
      toCSV(PAYROLL_TEMPLATE, [[`${ym}-10`, '홍길동', 2500000, `${Number(ym.slice(5))}월 급여`, '은행지급 기준']]),
    )
  }

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    try {
      const text = await file.text()
      const parsed = parseCSV(text)
      if (parsed.length < 2) throw new Error('데이터 행이 없습니다.')

      const { rows: out, skipped: skip } = buildPayrollRows(parsed, {
        existingNames,
        defaultProjectId,
        userId,
      })

      if (!out.length && !skip.length) throw new Error('등록할 행을 찾지 못했습니다.')
      setRows(out)
      setSkipped(skip)
    } catch (err) {
      setRows([])
      setSkipped([])
      setError(err.message)
    }
  }

  const submit = async () => {
    setSaving(true)
    try {
      await createEntries(rows)
      toast.success(
        `${rows.length}건이 등록되었습니다.${skipped.length ? ` (이미 등록된 ${skipped.length}건 건너뜀)` : ''}`,
      )
      onDone?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title="급여대장 올리기"
      subtitle="엑셀에서 CSV로 저장한 급여대장을 한 번에 등록합니다. 같은 월·같은 성명은 자동으로 건너뜁니다."
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={saving || !rows.length}>
            {saving ? '등록 중…' : `${rows.length}건 등록`}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="btn-ghost cursor-pointer">
            <Icon name="upload" size={16} />
            CSV 파일 선택
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
          </label>
          <button type="button" className="btn-ghost" onClick={downloadTemplate}>
            <Icon name="download" size={16} />
            양식 다운로드
          </button>
        </div>

        <div className="rounded-lg border border-ink-200 bg-ink-50/60 p-3.5 text-xs leading-relaxed text-ink-600">
          <p className="font-semibold text-ink-700">필수 열</p>
          <p>일자(YYYY-MM-DD), 성명, 급여(원)</p>
          <p className="mt-2 font-semibold text-ink-700">선택 열</p>
          <p>적요(없으면 ○월 급여), 메모</p>
          <p className="mt-2">항목은 인건비, 귀속은 비젠공통(관리)으로 자동 지정됩니다. 부가세는 0원입니다.</p>
        </div>

        {error ? <p className="text-sm font-medium text-loss">{error}</p> : null}

        {skipped.length ? (
          <p className="text-xs font-semibold text-amber-700">
            이미 등록된 {skipped.length}건은 건너뜁니다: {skipped.map((s) => s.name).join(', ')}
          </p>
        ) : null}

        {rows.length ? (
          <div className="overflow-hidden rounded-lg border border-ink-200">
            <p className="border-b border-ink-200 bg-ink-50 px-3.5 py-2 text-xs font-bold text-ink-700">
              미리보기 · 총 {rows.length}건
            </p>
            <div className="max-h-64 overflow-auto">
              <table className="w-full min-w-[520px] border-collapse text-xs">
                <thead className="bg-white">
                  <tr>
                    <th className="th">일자</th>
                    <th className="th">성명</th>
                    <th className="th">구분</th>
                    <th className="th text-right">급여</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {rows.slice(0, 20).map((row, index) => (
                    <tr key={index}>
                      <td className="td py-2 text-xs">{row.entry_date}</td>
                      <td className="td py-2 text-xs">{row.counterparty}</td>
                      <td className="td py-2 text-xs">
                        {staffNames.has(row.counterparty) ? (
                          <span className="chip bg-brand-50 text-brand-700">내부</span>
                        ) : (
                          <span className="chip bg-amber-50 text-amber-700">단기·외부</span>
                        )}
                      </td>
                      <td className="td num py-2 text-xs">{formatKRW(row.supply_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 20 ? (
                <p className="border-t border-ink-100 px-3.5 py-2 text-xs text-ink-500">
                  외 {rows.length - 20}건
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <EmptyState
            icon="upload"
            title="파일을 선택해 주세요"
            description="엑셀에서 CSV(쉼표로 분리)로 저장한 뒤 올리면 됩니다."
          />
        )}
      </div>
    </Modal>
  )
}

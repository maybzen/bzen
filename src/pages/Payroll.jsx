import { useCallback, useEffect, useMemo, useState } from 'react'
import EntryFormModal from '../components/EntryFormModal'
import EntryTable from '../components/EntryTable'
import Icon from '../components/Icon'
import { AttachmentModal } from '../components/Attachments'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, InlineAlert, LoadingBlock, Modal, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { formatKRW, monthEnd, todayISO } from '../lib/format'
import { INTERNAL_PROJECT_NAME, sortManagers } from '../lib/constants'
import { downloadTextFile, parseCSV, toCSV } from '../lib/csv'
import {
  createEntries,
  deleteEntry,
  deleteSlip,
  listAttachments,
  listEntries,
  listProfiles,
  listProjects,
  listSlips,
  updateEntry,
  upsertSlip,
} from '../lib/api'

/**
 * 급여관리 (관리자 전용).
 * 귀속월 기준 월별 급여대장입니다. 장부 입력일이 지급일이라 한 달씩 밀리므로
 * 적요의 "N월 급여"를 귀속월로 씁니다 (예: 9/10 지급 "8월 급여" → 8월).
 * - 급여: 인건비 (4대보험 제외)
 * - 4대보험: 카테고리와 무관하게 거래처(건보·근복공단) 기준으로 분리합니다.
 * - 세금·원천징수: 세금과공과 + 메모에 원천징수가 적힌 행
 * - 명세서: 지급 5항목·공제 6항목을 breakdown으로 저장합니다 (payroll_slips).
 *   저장하면 장부 금액이 실지급액으로 맞춰집니다.
 */

const INSURANCE = ['국민건강보험공단', '근로복지공단']

export const isInsurance = (e) => INSURANCE.includes(String(e.counterparty || '').trim())
export const isSalary = (e) => e.category === '인건비' && !isInsurance(e)
export const isTaxRow = (e) =>
  !isSalary(e) &&
  !isInsurance(e) &&
  (e.category === '세금과공과' || /원천징수/.test(`${e.description || ''} ${e.memo || ''}`))

/**
 * 귀속월 (YYYY-MM). 적요의 "2026년 8월 급여" / "8월 급여"를 우선하고,
 * 없으면 입력일(지급일) 기준으로 둡니다.
 */
export function attrMonth(e) {
  const text = `${e.description || ''} ${e.memo || ''}`
  let m = text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*급여/)
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}`
  m = text.match(/(\d{1,2})\s*월\s*급여/)
  if (m) {
    const y = String(e.entry_date || '').slice(0, 4) || String(new Date().getFullYear())
    return `${y}-${String(Number(m[1])).padStart(2, '0')}`
  }
  return String(e.entry_date || '').slice(0, 7)
}

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

/* 명세서 항목 정의 (급여명세서 양식 그대로) */
const PAY_FIELDS = [
  { key: 'base_pay', label: '기본급여' },
  { key: 'position_pay', label: '직책수당' },
  { key: 'meal_pay', label: '식대' },
  { key: 'overtime_pay', label: '고정연장근로수당' },
  { key: 'expense_pay', label: '지출결의' },
]
const DED_FIELDS = [
  { key: 'ded_pension', label: '국민연금' },
  { key: 'ded_health', label: '건강보험' },
  { key: 'ded_employment', label: '고용보험' },
  { key: 'ded_care', label: '장기요양보험료' },
  { key: 'ded_income', label: '소득세' },
  { key: 'ded_local_income', label: '지방소득세' },
]
const slipTotal = (slip, fields) => fields.reduce((a, f) => a + (Number(slip?.[f.key]) || 0), 0)

export default function Payroll() {
  const { isAdmin, user } = useAuth()
  const toast = useToast()

  const [ym, setYm] = useState(() => todayISO().slice(0, 7))
  /* 인명 칩 선택 ('' = 전체) */
  const [selName, setSelName] = useState('')

  /* 월 빠른선택: 2025-01 ~ 다음 달 */
  const ymOptions = useMemo(() => {
    const out = []
    let [y, m] = [2025, 1]
    const [ey, em] = shiftYm(todayISO().slice(0, 7), 1).split('-').map(Number)
    while (y < ey || (y === ey && m <= em)) {
      out.push(`${y}-${String(m).padStart(2, '0')}`)
      m += 1
      if (m > 12) {
        m = 1
        y += 1
      }
    }
    return out.reverse()
  }, [])
  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState([])
  const [prevEntries, setPrevEntries] = useState([])
  const [reportRows, setReportRows] = useState([])
  const [projects, setProjects] = useState([])
  const [profiles, setProfiles] = useState([])
  const [attachmentsByEntry, setAttachmentsByEntry] = useState({})
  const [slips, setSlips] = useState({})
  const [slipsMissing, setSlipsMissing] = useState(false)
  /* 명세서 저장된 행 id 목록 (명세서 ✓ 표시용) */
  const slipIds = useMemo(() => new Set(Object.keys(slips || {})), [slips])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [viewerFiles, setViewerFiles] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [importOpen, setImportOpen] = useState(false)
  const [slipEntry, setSlipEntry] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 귀속월 기준이라 지급월(다음 달)까지 넓게 가져와서 나눕니다.
      const prev = monthRange(shiftYm(ym, -1))
      const next = monthRange(shiftYm(ym, 1))
      const [all, projectRows, profileRows] = await Promise.all([
        listEntries({ from: prev.from, to: next.to }),
        listProjects(),
        listProfiles(),
      ])
      const pick = (rows) => (rows || []).filter((e) => isSalary(e) || isInsurance(e) || isTaxRow(e))
      const inYm = (rows) => pick(rows).filter((e) => attrMonth(e) === ym)
      setEntries(inYm(all))
      setPrevEntries(pick(all).filter((e) => attrMonth(e) === shiftYm(ym, -1)))
      setReportRows(
        (all || []).filter((e) => e.source === 'expense_report' && String(e.entry_date || '').slice(0, 7) === ym),
      )
      setProjects(projectRows || [])
      setProfiles(profileRows || [])

      const curRows = inYm(all)
      const files = await listAttachments(curRows.map((r) => r.id)).catch(() => [])
      const map = {}
      for (const file of files || []) {
        if (!map[file.entry_id]) map[file.entry_id] = []
        map[file.entry_id].push(file)
      }
      setAttachmentsByEntry(map)

      try {
        const slipRows = await listSlips(ym)
        const smap = {}
        for (const s of slipRows || []) smap[s.entry_id] = s
        setSlips(smap)
        setSlipsMissing(false)
      } catch (err) {
        if (/42P01|does not exist|schema cache/i.test(String(err?.message || ''))) {
          setSlipsMissing(true)
          setSlips({})
        } else {
          throw err
        }
      }
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

  /* 향란 → 보람 → 혜민 순서 (계정관리 담당자 순서와 동일), 나머지는 이름순 */
  const rankOf = useMemo(() => {
    const ordered = sortManagers(profiles || []).map((p) => String(p.full_name || '').trim())
    const map = new Map()
    ordered.forEach((n, i) => {
      if (n && !map.has(n)) map.set(n, i)
    })
    return map
  }, [profiles])
  const byStaffOrder = useCallback(
    (a, b) => {
      const ra = rankOf.get(String(a.counterparty || '').trim())
      const rb = rankOf.get(String(b.counterparty || '').trim())
      if (ra !== undefined || rb !== undefined) return (ra ?? 9999) - (rb ?? 9999)
      return String(a.counterparty || '').localeCompare(String(b.counterparty || ''), 'ko')
    },
    [rankOf],
  )

  /* 단기·외부 인력은 별도 섹션에서 관리합니다 (손선욱·행사 단기인력 등) */
  const staffSalaryRows = useMemo(
    () => salaryRows.filter((e) => personKind(e.counterparty) === '내부').sort(byStaffOrder),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salaryRows, staffNames, byStaffOrder],
  )
  const tempSalaryRows = useMemo(
    () =>
      salaryRows
        .filter((e) => personKind(e.counterparty) !== '내부')
        .sort((a, b) => String(a.counterparty || '').localeCompare(String(b.counterparty || ''), 'ko')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salaryRows, staffNames],
  )
  const tempTotal = useMemo(() => sumTotal(tempSalaryRows), [tempSalaryRows])
  const tempHeads = useMemo(
    () => new Set(tempSalaryRows.map((e) => String(e.counterparty || '').trim())).size,
    [tempSalaryRows],
  )
  /* 같은 귀속월·같은 성명은 1건이 원칙. 업로드 시 중복을 걸러냅니다. */
  const existingSalaryNames = useMemo(
    () => new Set(salaryRows.map((e) => String(e.counterparty || '').trim()).filter(Boolean)),
    [salaryRows],
  )
  const internalProjectId = useMemo(
    () => (projects || []).find((p) => p.name === INTERNAL_PROJECT_NAME)?.id || null,
    [projects],
  )

  /* 인명 칩 선택 (세 테이블 공통) */
  const matchName = useCallback(
    (e) => !selName || String(e.counterparty || '').trim() === selName,
    [selName],
  )
  const rosterStaff = useMemo(
    () => [...new Set(staffSalaryRows.map((e) => String(e.counterparty || '').trim()))].sort((a, b) => {
      const ra = rankOf.get(a)
      const rb = rankOf.get(b)
      if (ra !== undefined || rb !== undefined) return (ra ?? 9999) - (rb ?? 9999)
      return a.localeCompare(b, 'ko')
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [staffSalaryRows, rankOf],
  )
  const rosterTemp = useMemo(
    () => [...new Set(tempSalaryRows.map((e) => String(e.counterparty || '').trim()))].sort((a, b) => a.localeCompare(b, 'ko')),
    [tempSalaryRows],
  )
  const staffShown = useMemo(() => staffSalaryRows.filter(matchName), [staffSalaryRows, matchName])
  const tempShown = useMemo(() => tempSalaryRows.filter(matchName), [tempSalaryRows, matchName])
  const taxShown = useMemo(
    () => [...insuranceRows, ...taxRows].filter(matchName),
    [insuranceRows, taxRows, matchName],
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

  const profileIdOf = useCallback(
    (name) => (profiles || []).find((p) => String(p.full_name || '').trim() === String(name || '').trim())?.id || null,
    [profiles],
  )

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

  const openEdit = (entry) => {
    setEditing({ ...entry, attachments: attachmentsByEntry[entry.id] || [] })
    setFormOpen(true)
  }

  const [y, m] = ym.split('-').map(Number)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="급여관리"
        description="귀속월(근무한 달) 기준입니다. 지급일이 다음 달이어도 근무한 달에 집계됩니다."
      >
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setYm(shiftYm(ym, -1))} className="btn-ghost !px-2" aria-label="이전 달">
            <Icon name="chevron-left" size={16} />
          </button>
          <select
            className="input w-auto py-1.5 text-xs"
            value={ymOptions.includes(ym) ? ym : ''}
            onChange={(e) => e.target.value && setYm(e.target.value)}
            aria-label="월 선택"
          >
            {ymOptions.includes(ym) ? null : <option value="">{y}년 {m}월</option>}
            {ymOptions.map((o) => (
              <option key={o} value={o}>
                {o.slice(0, 4)}년 {Number(o.slice(5))}월
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setYm(shiftYm(ym, 1))} className="btn-ghost !px-2" aria-label="다음 달">
            <Icon name="chevron-right" size={16} />
          </button>
          <button type="button" onClick={() => setYm(todayISO().slice(0, 7))} className="btn-ghost !px-2.5 text-xs">
            이번 달
          </button>
        </div>
        {isAdmin ? (
          <button type="button" className="btn-primary" onClick={() => setImportOpen(true)}>
            <Icon name="upload" size={16} />
            급여대장 올리기
          </button>
        ) : null}
      </PageHeader>

      {(rosterStaff.length + rosterTemp.length) > 0 ? (
        <div className="card flex flex-wrap items-center gap-1.5 px-4 py-3">
          <span className="mr-1 text-xs font-semibold text-ink-500">사람</span>
          <button
            type="button"
            onClick={() => setSelName('')}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
              selName === '' ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
            }`}
          >
            전체
          </button>
          {rosterStaff.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setSelName((s) => (s === n ? '' : n))}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                selName === n ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
              }`}
            >
              {n}
            </button>
          ))}
          {rosterTemp.map((n) => (
            <button
              key={`t:${n}`}
              type="button"
              onClick={() => setSelName((s) => (s === n ? '' : n))}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                selName === n ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          {slipsMissing ? (
            <InlineAlert tone="warn">
              <strong>명세서 breakdown 저장소가 아직 없습니다.</strong> Supabase Dashboard → SQL Editor에서{' '}
              <code>supabase/migration_payroll_slips.sql</code> 내용을 실행한 뒤 새로고침하세요. (1분 소요)
              명세서 없이도 급여 조회·등록은 그대로 됩니다.
            </InlineAlert>
          ) : null}

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
                직원 급여 ({staffShown.length}건)
              </h2>
              <p className="mt-0.5 text-xs text-ink-500">
                합계 {formatKRW(sumTotal(staffShown))}원
              </p>
            </header>
            {staffShown.length ? (
              <EntryTable
                entries={staffShown}
                projects={projects}
                profiles={profiles}
                attachmentsByEntry={attachmentsByEntry}
                canEdit={isAdmin}
                onEdit={openEdit}
                onDelete={isAdmin ? setRemoving : undefined}
                onOpenAttachments={setViewerFiles}
                canChangeAuthor={isAdmin}
                onSlip={slipsMissing ? undefined : setSlipEntry}
                slipEntryIds={slipIds}
              />
            ) : (
              <EmptyState icon="coins" title={`${y}년 ${m}월 급여 내역이 없습니다`} description="급여대장 올리기로 기록하세요." />
            )}
          </section>

          <section className="card overflow-hidden">
            <header className="border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">
                단기·외부 인력 ({tempShown.length}건)
              </h2>
              <p className="mt-0.5 text-xs text-ink-500">
                계정이 없는 분(손선욱·행사 단기인력 등)은 여기서 따로 관리됩니다. 합계 {formatKRW(sumTotal(tempShown))}원
              </p>
            </header>
            {tempShown.length ? (
              <EntryTable
                entries={tempShown}
                projects={projects}
                profiles={profiles}
                attachmentsByEntry={attachmentsByEntry}
                canEdit={isAdmin}
                onEdit={openEdit}
                onDelete={isAdmin ? setRemoving : undefined}
                onOpenAttachments={setViewerFiles}
                canChangeAuthor={isAdmin}
                onSlip={slipsMissing ? undefined : setSlipEntry}
                slipEntryIds={slipIds}
              />
            ) : (
              <EmptyState icon="users" title="단기·외부 인력 급여가 없습니다" />
            )}
          </section>

          <section className="card overflow-hidden">
            <header className="border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">
                4대보험·세금·원천징수 ({taxShown.length}건)
              </h2>
            </header>
            {taxShown.length ? (
              <EntryTable
                entries={taxShown}
                projects={projects}
                profiles={profiles}
                attachmentsByEntry={attachmentsByEntry}
                canEdit={isAdmin}
                onEdit={openEdit}
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

      {!slipsMissing && slipEntry ? (
        <SlipModal
          open={Boolean(slipEntry)}
          onClose={() => setSlipEntry(null)}
          onSaved={() => {
            setSlipEntry(null)
            setReloadKey((k) => k + 1)
          }}
          entry={slipEntry}
          ym={ym}
          initial={slips[slipEntry.id] || null}
          reportRows={reportRows}
          projects={projects}
          personId={profileIdOf(slipEntry.counterparty)}
          userId={user?.id}
        />
      ) : null}
    </div>
  )
}

/* --------------------------- 급여명세서 (breakdown) --------------------------- */

function SlipModal({ open, onClose, onSaved, entry, ym, initial, reportRows, projects, personId, userId }) {
  const toast = useToast()
  const [form, setForm] = useState({})
  const [checked, setChecked] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const name = String(entry?.counterparty || '').trim()

  /* 이 달 지출결의: ① 본인 지출(requester) ② 코드 미지정(이용자 표기) */
  const mine = useMemo(
    () => (reportRows || []).filter((r) => personId && r.requester_id === personId),
    [reportRows, personId],
  )
  const coded = useMemo(
    () => (reportRows || []).filter((r) => !r.requester_id),
    [reportRows],
  )
  const mineTotal = useMemo(() => sumTotal(mine), [mine])

  useEffect(() => {
    if (!open || !entry) return
    setError('')
    const base = {}
    for (const f of [...PAY_FIELDS, ...DED_FIELDS]) base[f.key] = Number(initial?.[f.key]) || 0
    // 저장된 명세서가 없으면 본인 지출 합계를 지출결의에 미리 넣습니다.
    if (!initial && !base.expense_pay && mineTotal) base.expense_pay = mineTotal
    setForm(base)
    const next = {}
    for (const r of mine) next[r.id] = true
    setChecked(next)
  }, [open, entry, initial, mineTotal]) // eslint-disable-line react-hooks/exhaustive-deps

  const setNum = (key) => (e) => {
    const v = Math.round(Number(String(e.target.value).replace(/[^0-9.-]/g, '')) || 0)
    setForm((f) => ({ ...f, [key]: v }))
  }

  const toggle = (id) => setChecked((m) => ({ ...m, [id]: !m[id] }))

  const checkedTotal = useMemo(() => {
    const all = [...mine, ...coded]
    return all.filter((r) => checked[r.id]).reduce((a, r) => a + Number(r.total_amount || 0), 0)
  }, [mine, coded, checked])

  const payTotal = slipTotal(form, PAY_FIELDS)
  const dedTotal = slipTotal(form, DED_FIELDS)
  const net = payTotal - dedTotal
  const expensePay = Number(form.expense_pay) || 0
  // 우리 회사는 지출결의를 급여에 포함해서 줍니다. 지결은 별도 행으로 잡히므로
  // 장부 급여분은 실지급액에서 지출결의를 뺀 금액으로 맞춥니다 (중복 방지).
  const bookAmount = net - expensePay
  const projectNameOf = (id) => (projects || []).find((p) => p.id === id)?.name || ''

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await upsertSlip(
        {
          entry_id: entry.id,
          ym,
          person: name,
          ...Object.fromEntries([...PAY_FIELDS, ...DED_FIELDS].map((f) => [f.key, Number(form[f.key]) || 0])),
        },
        userId,
      )
      await updateEntry(entry.id, { supply_amount: bookAmount, vat_amount: 0 })
      toast.success(`명세서 저장 + 장부 급여분 ${formatKRW(bookAmount)}원 반영`)
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!entry) return null

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title={`${name} · ${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월 급여명세서`}
      subtitle={`귀속 ${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월 · 지급일 ${entry.entry_date || '—'} · 장부 합계 ${formatKRW(entry.total_amount)}원 · 저장하면 급여분 ${formatKRW(bookAmount)}원(실지급 ${formatKRW(net)} − 지출결의 ${formatKRW(expensePay)})으로 맞춰집니다.`}
      size="lg"
      footer={
        <>
          {initial?.id ? (
            <button
              type="button"
              className="mr-auto text-xs font-semibold text-loss hover:underline"
              disabled={saving}
              onClick={async () => {
                if (!window.confirm('명세서만 삭제합니다. 장부 급여 행은 남습니다. 계속할까요?')) return
                setSaving(true)
                setError('')
                try {
                  await deleteSlip(entry.id)
                  toast.success('명세서를 삭제했습니다. 장부는 그대로 둡니다.')
                  onSaved?.()
                } catch (err) {
                  setError(err.message)
                } finally {
                  setSaving(false)
                }
              }}
            >
              명세서만 삭제
            </button>
          ) : null}
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="submit" form="slip-form" className="btn-primary" disabled={saving}>
            {saving ? '저장 중…' : '명세서 저장'}
          </button>
        </>
      }
    >
      <form id="slip-form" onSubmit={submit} className="flex flex-col gap-4">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-ink-200 p-3.5">
            <p className="mb-2 text-xs font-bold text-ink-700">지급항목 (합계 {formatKRW(payTotal)}원)</p>
            <div className="flex flex-col gap-2">
              {PAY_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="shrink-0 font-semibold text-ink-600">{f.label}</span>
                  <input
                    type="number"
                    className="input w-32 py-1 text-right text-xs"
                    value={form[f.key] ?? 0}
                    onChange={setNum(f.key)}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-ink-200 p-3.5">
            <p className="mb-2 text-xs font-bold text-ink-700">공제항목 (합계 {formatKRW(dedTotal)}원)</p>
            <div className="flex flex-col gap-2">
              {DED_FIELDS.map((f) => (
                <label key={f.key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="shrink-0 font-semibold text-ink-600">{f.label}</span>
                  <input
                    type="number"
                    className="input w-32 py-1 text-right text-xs"
                    value={form[f.key] ?? 0}
                    onChange={setNum(f.key)}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-ink-50/80 px-3.5 py-2.5 text-xs font-bold text-ink-800">
          실지급액 {formatKRW(net)}원 (지급 {formatKRW(payTotal)} − 공제 {formatKRW(dedTotal)})
          <span className="mt-0.5 block font-normal text-ink-500">
            장부 반영액 {formatKRW(bookAmount)}원 (실지급 − 지출결의, 지결 행과 중복 방지)
          </span>
        </div>

        <div className="rounded-lg border border-ink-200 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-ink-700">
              이 달 지출결의 (선택 합계 {formatKRW(checkedTotal)}원)
            </p>
            <button
              type="button"
              className="text-xs font-bold text-brand-700 hover:underline"
              onClick={() => setForm((f) => ({ ...f, expense_pay: checkedTotal }))}
            >
              합계를 지출결의에 반영
            </button>
          </div>
          {mine.length + coded.length ? (
            <ul className="mt-2 flex max-h-44 flex-col gap-1 overflow-auto">
              {[...mine, ...coded].map((r) => (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition hover:bg-ink-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-brand-600"
                      checked={Boolean(checked[r.id])}
                      onChange={() => toggle(r.id)}
                    />
                    <span className="w-20 shrink-0 font-semibold text-ink-500">{String(r.entry_date || '').slice(5)}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-800">
                      {r.counterparty} · {r.description}
                      {projectNameOf(r.project_id) ? ` · ${projectNameOf(r.project_id)}` : ''}
                      {r.requester_id ? '' : ' (코드 미지정)'}
                    </span>
                    <span className="shrink-0 font-num font-bold tabular-nums">{formatKRW(r.total_amount)}원</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-ink-400">이 달에 올라온 지출결의가 없습니다.</p>
          )}
          <p className="mt-2 text-[11px] text-ink-400">
            본인 지출(requester)은 자동 체크됩니다. 코드(E·SH 등) 행은 해당 달·해당 인원이 맞는지 보고 체크하세요.
          </p>
        </div>
      </form>
    </Modal>
  )
}

/* --------------------------- 급여대장 일괄 등록 --------------------------- */

const PAYROLL_TEMPLATE = ['일자', '성명', '급여', '적요', '메모']

/**
 * 급여대장 CSV 파싱 → 장부 행 변환 (순수 함수, 검증 스크립트에서 씁니다).
 * 같은 귀속월·같은 성명은 1건이 원칙이라 이미 등록된 성명은 건너뜁니다.
 */
export function buildPayrollRows(parsed, { existingNames = new Set(), defaultProjectId = null, userId = null, ym = '' } = {}) {
  // 적요가 비면 보고 있는 달(귀속월)의 "N월 급여"로 둡니다. 지급일 기준이 아닙니다.
  const attrLabel = ym ? `${Number(String(ym).slice(5))}월 급여` : ''
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
          : attrLabel || `${Number(date.slice(5, 7))}월 급여`,
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
        ym,
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
      subtitle="엑셀에서 CSV로 저장한 급여대장을 한 번에 등록합니다. 같은 귀속월·같은 성명은 자동으로 건너뜁니다."
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
          <p>일자(YYYY-MM-DD, 지급일), 성명, 급여(원, 실지급액)</p>
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

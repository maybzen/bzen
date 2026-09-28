import { useCallback, useEffect, useMemo, useState } from 'react'
import EntryFormModal from '../components/EntryFormModal'
import EntryTable from '../components/EntryTable'
import Icon from '../components/Icon'
import { AttachmentModal } from '../components/Attachments'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, LoadingBlock, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { formatKRW, monthEnd, todayISO } from '../lib/format'
import { deleteEntry, listAttachments, listEntries, listProfiles, listProjects } from '../lib/api'

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

  const salaryTotal = useMemo(() => sumTotal(salaryRows), [salaryRows])
  const prevSalaryTotal = useMemo(() => sumTotal(prevEntries.filter(isSalary)), [prevEntries])
  const insuranceTotal = useMemo(() => sumTotal(insuranceRows), [insuranceRows])
  const taxTotal = useMemo(() => sumTotal(taxRows), [taxRows])

  const internalCount = useMemo(
    () => new Set(salaryRows.filter((e) => personKind(e.counterparty) === '내부').map((e) => (e.counterparty || '').trim())).size,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salaryRows, staffNames],
  )
  const externalTotal = useMemo(
    () => sumTotal(salaryRows.filter((e) => personKind(e.counterparty) !== '내부')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [salaryRows, staffNames],
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
          <button type="button" className="btn-primary" onClick={openNew}>
            <Icon name="plus" size={16} />
            급여 등록
          </button>
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
              hint={`내부 ${internalCount}명 · 외부·단기 ${formatKRW(externalTotal)}원`}
            />
            <StatCard label="4대보험 회사부담" value={insuranceTotal} tone="opex" icon="receipt" hint="건보·산재" />
            <StatCard label="세금·원천징수" value={taxTotal} tone={taxTotal > 0 ? 'loss' : 'neutral'} icon="file" hint="원천세 등" />
          </div>

          <section className="card overflow-hidden">
            <header className="border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">
                직원별 급여 ({salaryRows.length}건)
              </h2>
              <p className="mt-0.5 text-xs text-ink-500">
                계정이 없는 외부·단기 인력(예: 손선욱)도 거래처명으로 그대로 잡힙니다.
              </p>
            </header>
            {salaryRows.length ? (
              <EntryTable
                entries={salaryRows}
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
              <EmptyState icon="coins" title={`${y}년 ${m}월 급여 내역이 없습니다`} description="급여 등록으로 해당 월 급여를 기록하세요." />
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
    </div>
  )
}

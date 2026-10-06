import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import CardUserSelect from './CardUserSelect'
import PartnerPicker from './PartnerPicker'
import { AmountInput, Field, InlineAlert, Modal, Spinner } from './ui'
import { useToast } from './Toast'
import { CATEGORIES, ENTRY_META, INTERNAL_PROJECT_NAME, PAYMENT_METHODS, categoryHint, suggestCategory } from '../lib/constants'
import { formatFileSize, formatKRW, todayISO } from '../lib/format'
import { createEntry, deleteAttachment, listFundRows, updateEntry, uploadAttachment } from '../lib/api'
import { ensureLedgerIndex, useLedgerIndex } from '../lib/ledgerIndex'
import { isStaffVisible, staffIdsFromProfiles } from '../lib/permissions'
import { ISSUE_META, checkEntryDraft } from '../lib/validate'
import { aliasRoot } from '../lib/aliases'

const MAX_FILE = 20 * 1024 * 1024

function toNumber(value) {
  const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? Math.round(n) : 0
}

/** 메모의 "· 이용자 XXX" 읽기/쓰기 (법인카드 화면과 같은 형식) */
function memoUser(memo) {
  const m = String(memo || '').match(/이용자\s+([^·]+)/)
  return m ? m[1].trim() : ''
}

function withMemoUser(memo, user) {
  const base = String(memo || '').replace(/\s*·\s*이용자\s+[^·]*/, '').trim()
  const u = String(user || '').trim()
  return u ? `${base} · 이용자 ${u}` : base
}

/** 메모의 "· 법카 2381" 읽기/쓰기. 뒤 4자리 기준으로 통일합니다 */
function memoCard(memo) {
  const m = String(memo || '').match(/법카\s+([^·]+)/)
  if (!m) return ''
  const d = (m[1].match(/(\d{4})(?!.*\d)/) || [])[1]
  return d ? `법카 ${d}` : ''
}

function withMemoCard(memo, label) {
  const base = String(memo || '').replace(/\s*·\s*법카\s+[^·]*/, '').trim()
  const v = String(label || '').trim()
  return v ? `${base} · ${v}` : base
}

function cardLast4(number) {
  const digits = String(number || '').replace(/[^0-9]/g, '')
  return digits.slice(-4)
}

const LABELS = {
  sale: { party: '거래처', category: '매출 항목', amount: '매출액' },
  purchase: { party: '구매처', category: '매입 항목', amount: '매입액' },
  opex: { party: '사용처', category: '비목', amount: '지출액' },
}

export default function EntryFormModal({
  open,
  onClose,
  onSaved,
  entryType = 'sale',
  source = 'manual',
  initial = null,
  projects = [],
  profiles = [],
  partnerNames = [],
  isAdmin = false,
  userId = null,
  /* 프로젝트 상세에서 열 때: 신규 등록분을 그 프로젝트로 자동 지정 */
  defaultProjectId = '',
}) {
  const toast = useToast()
  const meta = ENTRY_META[entryType] || ENTRY_META.sale
  const labels = LABELS[entryType] || LABELS.sale
  const isReport = source === 'expense_report'

  const [form, setForm] = useState(() => emptyForm(entryType, source, userId))
  const [totalDraft, setTotalDraft] = useState('')
  /* 면세·영세: 합계를 그대로 공급가액으로 넣고 세액은 0으로 둡니다 (DB 컬럼이 아니라 화면 상태) */
  const [taxFree, setTaxFree] = useState(false)
  const [files, setFiles] = useState([])
  const [existing, setExisting] = useState([])
  const [removed, setRemoved] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  /* 경고를 확인하고 "그래도 저장"을 누른 뒤에야 실제 저장이 진행됩니다 */
  const [forceSave, setForceSave] = useState(false)
  /* 자금관리에 등록된 법인카드 목록 (결제수단=카드 선택 시) */
  const [fundCards, setFundCards] = useState([])
  /* 중복·표기 대조용 장부 전체 (관리자만 조회 가능) */
  const ledger = useLedgerIndex({ enabled: open })

  /** 신규 등록 시 프로젝트 미선택이면 사내 공통(비젠공통·관리)으로 자동 지정 (effect보다 먼저 선언) */
  const internalProjectId = useMemo(
    () => projects.find((p) => p.name === INTERNAL_PROJECT_NAME)?.id || '',
    [projects],
  )

  /**
   * 프로젝트 목록: 비젠공통 최상단, 나머지는 입력 일자(행사 시점)에 가까운 순.
   * 행사 기간에 입력일이 들어있으면 최우선, 그 외는 시작·종료일 중 가까운 순.
   * 날짜가 없는 프로젝트는 뒤로 보냅니다.
   */
  const sortedProjects = useMemo(() => {
    const top = []
    const rest = []
    ;(projects || []).forEach((p) => {
      if (p?.name === INTERNAL_PROJECT_NAME) top.push(p)
      /* 완료된 프로젝트는 숨김. 단, 이미 연결된 건(수정 화면)은 보여줍니다 */
      else if (p?.status !== 'done' || p?.id === form.project_id) rest.push(p)
    })
    const ref = String(form.entry_date || '').slice(0, 10)
    const dist = (p) => {
      const s = String(p?.start_date || '').slice(0, 10)
      const e = String(p?.end_date || '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ref) || (!s && !e)) return null
      if (s && e && ref >= s && ref <= e) return 0
      if (s && !e && ref >= s) return 0
      const diffs = [s, e]
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .map((d) => Math.abs(new Date(`${d}T00:00:00`) - new Date(`${ref}T00:00:00`)))
      return diffs.length ? Math.min(...diffs) : null
    }
    const newer = (a, b) => String(b?.created_at || '').localeCompare(String(a?.created_at || ''))
    rest.sort((a, b) => {
      const da = dist(a)
      const db = dist(b)
      if (da == null && db == null) return newer(a, b)
      if (da == null) return 1
      if (db == null) return -1
      return da - db || newer(a, b)
    })
    return [...top, ...rest]
  }, [projects, form.entry_date, form.project_id])

  /* 비목 콤보박스: 타이핑 뒤에도 목록에서 고를 수 있습니다 */
  const [catOpen, setCatOpen] = useState(false)
  useEffect(() => {
    if (open) setCatOpen(false)
  }, [open ])
  const catQuery = String(form.category || '').trim()
  const catFiltered = useMemo(() => {
    const base = CATEGORIES[entryType] || []
    if (!catQuery) return base
    return base.filter((c) => c.includes(catQuery))
  }, [entryType, catQuery])

  useEffect(() => {
    if (!open) return
    listFundRows('fund_cards')
      .then((rows) => setFundCards((rows || []).filter((c) => c.is_active !== false)))
      .catch(() => setFundCards([]))
    setError('')
    setForceSave(false)
    setFiles([])
    setRemoved([])
    setTotalDraft('')
    setTaxFree(false)
    if (initial) {
      setForm({
        doc_no: initial.doc_no || '',
        entry_date: initial.entry_date || todayISO(),
        project_id: initial.project_id || '',
        counterparty: initial.counterparty || '',
        category: initial.category || '',
        description: initial.description || '',
        supply_amount: String(initial.supply_amount ?? 0),
        vat_amount: String(initial.vat_amount ?? 0),
        payment_method: initial.payment_method || '',
        memo: initial.memo || '',
        card_user: memoUser(initial.memo),
        card_label: memoCard(initial.memo),
        requester_id: initial.requester_id || userId || '',
        author_id: initial.created_by || userId || '',
      })
      setExisting(initial.attachments || [])
    } else {
      setForm({
        ...emptyForm(entryType, source, userId),
        project_id: defaultProjectId || internalProjectId,
      })
      setExisting([])
    }
  }, [open, initial, entryType, source, userId, internalProjectId, defaultProjectId])

  const supply = toNumber(form.supply_amount)
  const vat = toNumber(form.vat_amount)
  const total = supply + vat

  const set = (key) => (e) => {
    // 값이 바뀌면 경고 확인 상태는 다시 비운다 (그래도 저장 → 재확인)
    setForceSave(false)
    setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  /** 금액처럼 한 번에 여러 칸을 바꾸는 경우에도 경고 확인 상태를 초기화 */
  const setFields = (updater) => {
    setForceSave(false)
    setForm(updater)
  }

  /* 저장 전에 장부와 대조해 문제를 알려줍니다. 저장은 막지 않습니다. */
  /* 직원은 본인 화면에 보이는 범위 안에서만 대조합니다 (관리자 내역 노출 방지) */
  const staffIds = useMemo(() => staffIdsFromProfiles(profiles), [profiles])
  const visibleEntries = useMemo(
    () => (isAdmin ? ledger.entries : (ledger.entries || []).filter((e) => isStaffVisible(e, staffIds))),
    [isAdmin, ledger.entries, staffIds],
  )

  const draftValues = useMemo(
    () => ({
      entry_type: entryType,
      entry_date: form.entry_date,
      counterparty: form.counterparty,
      category: form.category,
      description: form.description,
      doc_no: form.doc_no,
      supply_amount: supply,
      vat_amount: vat,
      memo: form.memo,
      project_id: form.project_id,
    }),
    [entryType, form, supply, vat],
  )

  const warnings = useMemo(() => {
    /* 직원은 경고 없이 바로 저장 (마찰 줄이기). 관리자는 전체 대조 유지. */
    if (!isAdmin) return []
    if (supply === 0 && vat === 0) return []
    return checkEntryDraft(draftValues, { entries: visibleEntries, excludeId: initial?.id || '', aliasRoot })
  }, [draftValues, supply, vat, visibleEntries, initial?.id, isAdmin])

  /* 저장 전 경고를 확인해야 하는 단계인가 */
  const needConfirm = warnings.length > 0 && !forceSave

  const onPickFiles = (e) => {
    const picked = Array.from(e.target.files || [])
    const accepted = []
    for (const file of picked) {
      if (file.size > MAX_FILE) {
        toast.error(`"${file.name}" 은(는) 20MB 를 넘어 제외했습니다.`)
        continue
      }
      accepted.push(file)
    }
    setFiles((prev) => [...prev, ...accepted])
    e.target.value = ''
  }

  const removeExisting = (file) => {
    setRemoved((prev) => [...prev, file])
    setExisting((prev) => prev.filter((f) => f.id !== file.id))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!form.entry_date) return setError('일자를 선택해 주세요.')
    if (supply === 0 && vat === 0) return setError('금액을 입력해 주세요. (카드 취소건은 음수로 입력)')
    if (isReport && !form.requester_id && !userId) return setError('지출자를 선택해 주세요.')
    // 장부 대조 데이터가 아직 없으면 잠깐 기다렸다가 검사합니다 (중복 경고를 놓치지 않기 위해).
    // 8초 안에 안 오면 입력값 자체의 문제(깨진 텍스트·부가세·비목)만으로 판단하고 진행합니다.
    // 직원은 경고 없이 바로 저장합니다.
    let liveWarnings = warnings
    if (!ledger.ready && isAdmin) {
      try {
        const fresh = await Promise.race([
          ensureLedgerIndex(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('ledger timeout')), 8000)
          }),
        ])
        const rows = isAdmin
          ? fresh?.entries || []
          : (fresh?.entries || []).filter((e) => isStaffVisible(e, staffIds))
        if (rows.length) {
          liveWarnings = checkEntryDraft(draftValues, { entries: rows, excludeId: initial?.id || '', aliasRoot })
        }
      } catch {
        /* 대조 없이 진행 */
      }
    }
    // 경고가 있으면 먼저 보여주고, 확인 전에는 저장하지 않습니다.
    if (liveWarnings.length > 0 && !forceSave) {
      setForceSave(true)
      toast.info(`확인할 항목 ${liveWarnings.length}건이 있습니다. 다시 누르면 저장됩니다.`)
      return
    }

    setSaving(true)
    try {
      const payload = {
        entry_type: entryType,
        source,
        doc_no: form.doc_no.trim(),
        entry_date: form.entry_date,
        project_id: form.project_id || null,
        counterparty: form.counterparty.trim(),
        category: form.category.trim(),
        description: form.description.trim(),
        supply_amount: supply,
        vat_amount: vat,
        payment_method: form.payment_method,
        memo: withMemoCard(
          withMemoUser(form.memo, form.card_user),
          form.payment_method === '카드' ? form.card_label : '',
        ),
        requester_id: isReport ? form.requester_id || userId : form.requester_id || null,
        // 등록자(작성자) 수정은 기존 내역만. 관리자가 바꿀 수 있고, 입사 전 자료 정정용입니다.
        // 신규 등록은 RLS가 created_by = 로그인 계정으로 강제하므로 키를 보내지 않습니다.
        ...(isAdmin && initial?.id ? { created_by: form.author_id || null } : {}),
      }

      let record
      if (initial?.id) {
        record = await updateEntry(initial.id, payload)
      } else {
        record = await createEntry(payload, userId)
      }

      for (const file of removed) {
        try {
          await deleteAttachment(file)
        } catch {
          /* 파일 삭제 실패는 무시하고 진행 */
        }
      }

      const uploaded = []
      for (const file of files) {
        try {
          uploaded.push(await uploadAttachment(record.id, file, userId))
        } catch (uploadError) {
          toast.error(uploadError.message)
        }
      }

      toast.success(initial?.id ? '수정되었습니다.' : `${isReport ? '지출결의' : meta.label}이(가) 등록되었습니다.`)
      setForceSave(false)
      onSaved?.(record, uploaded)
      onClose?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const title = initial?.id
    ? `${isReport ? '지출결의' : meta.label} 수정`
    : isReport
      ? '지출결의 등록'
      : `${meta.label} 등록`

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title={title}
      subtitle={
        isReport
          ? '사용 내역과 증빙을 기록합니다.'
          : `${meta.label} 건을 장부에 기록합니다.`
      }
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="submit" form="entry-form" className="btn-primary" disabled={saving}>
            {saving ? <Spinner size={15} /> : <Icon name={needConfirm ? 'alert' : 'check'} size={15} />}
            {saving ? '저장 중…' : needConfirm ? '경고 확인' : '저장'}
          </button>
        </>
      }
    >
      <form id="entry-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}

        {warnings.length ? (
          <div
            className={`rounded-lg border px-3.5 py-3 text-xs leading-relaxed ${
              needConfirm
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
          >
            <div className="mb-2 flex items-start gap-2">
              <Icon name={needConfirm ? 'alert' : 'check'} size={15} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-bold">
                  {needConfirm
                    ? `저장 전에 확인해 주세요 (${warnings.length}건)`
                    : `확인 완료 · 그래도 저장합니다 (${warnings.length}건)`}
                </p>
                {!needConfirm ? (
                  <p className="mt-0.5 opacity-80">문제가 있으면 저장 후 장부에서 고칠 수 있습니다.</p>
                ) : null}
              </div>
            </div>
            <ul className="flex flex-col gap-1.5">
              {warnings.map((w, i) => {
                const meta = ISSUE_META[w.code] || {}
                return (
                  <li key={`${w.code}-${i}`} className="flex items-start gap-2 rounded-md bg-white/70 px-2.5 py-1.5">
                    <span className="mt-0.5 shrink-0 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-bold text-ink-600">
                      {meta.label || w.code}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{w.title}</span>
                      {w.detail ? <span className="block opacity-80">{w.detail}</span> : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="일자" required>
            <input type="date" className="input" value={form.entry_date} onChange={set('entry_date')} required />
          </Field>

          {isReport ? (
            <Field label="프로젝트" hint="프로젝트별 손익에 반영됩니다.">
              <select className="input" value={form.project_id} onChange={set('project_id')}>
                <option value="">선택 없음</option>
                {sortedProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.code ? ` (${p.code})` : ''}
                  </option>
                ))}
              </select>
              {!sortedProjects.length ? (
                <p className="mt-1 text-xs text-loss">프로젝트를 불러오지 못했습니다. 페이지를 새로고침해 주세요.</p>
              ) : null}
            </Field>
          ) : (
            <Field label="프로젝트" hint={`비우면 공통비용으로 잡힙니다.${sortedProjects.length ? '' : ' (목록 로딩 실패 — 새로고침해 주세요)'}`}>
              <select className="input" value={form.project_id} onChange={set('project_id')}>
                <option value="">선택 없음 (공통)</option>
                {sortedProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.code ? ` (${p.code})` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field label={labels.party}>
            <PartnerPicker
              value={form.counterparty}
              onChange={set('counterparty')}
              placeholder={entryType === 'sale' ? '예: ○○ 주식회사' : '예: □□ 상사'}
              userId={userId}
              ledgerEntries={visibleEntries}
              excludeId={initial?.id || ''}
            />
          </Field>

          <Field label={labels.category}>
            <div className="relative">
              <input
                className="input pr-9"
                placeholder="목록에서 선택하거나 직접 입력 (비워도 됨)"
                value={form.category}
                onChange={set('category')}
                onFocus={() => setCatOpen(true)}
              />
              <button
                type="button"
                aria-label="비목 목록 보기"
                onClick={() => setCatOpen((v) => !v)}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-sm text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
              >
                ▾
              </button>
              {catOpen ? (
                <>
                  <button
                    type="button"
                    aria-label="목록 닫기"
                    className="fixed inset-0 z-[80] cursor-default"
                    onClick={() => setCatOpen(false)}
                  />
                  <ul className="absolute z-[81] mt-1 max-h-52 w-full overflow-auto rounded-lg border border-ink-200 bg-white py-1 shadow-pop">
                    {catFiltered.map((c) => (
                      <li key={c}>
                        <button
                          type="button"
                          className="block w-full truncate px-3 py-2 text-left text-sm transition hover:bg-ink-50"
                          onClick={() => {
                            setFields((f) => ({ ...f, category: c }))
                            setCatOpen(false)
                          }}
                        >
                          {c}
                        </button>
                      </li>
                    ))}
                    {catFiltered.length ? null : (
                      <li className="px-3 py-2 text-xs text-ink-400">
                        일치하는 비목 없음 — 입력한 그대로 저장됩니다
                      </li>
                    )}
                  </ul>
                </>
              ) : null}
            </div>
            {categoryHint(form.category) ? (
              <p className="mt-1 text-xs text-ink-500">💡 {categoryHint(form.category)}</p>
            ) : null}
            {(() => {
              const s = suggestCategory(form.counterparty, form.description, entryType)
              if (!s || s.category === String(form.category || '').trim()) return null
              return (
                <button
                  type="button"
                  onClick={() => setFields((f) => ({ ...f, category: s.category }))}
                  className="mt-1.5 text-xs font-semibold text-brand-700 hover:underline"
                >
                  추천: {s.category} 넣기
                </button>
              )
            })()}
          </Field>

          <Field label="적요" className="sm:col-span-2">
            <input
              className="input"
              placeholder="예: 9월 홈페이지 유지보수"
              value={form.description}
              onChange={set('description')}
            />
          </Field>
        </div>

        <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="공급가액">
              <AmountInput
                className="input num text-left"
                value={form.supply_amount}
                onChange={set('supply_amount')}
                placeholder="0"
              />
            </Field>

            <Field label="부가세">
              <div className="flex gap-1.5">
                <AmountInput
                  className="input num text-left"
                  value={form.vat_amount}
                  onChange={set('vat_amount')}
                  placeholder="0"
                />
                <button
                  type="button"
                  className="btn-ghost shrink-0 whitespace-nowrap px-2.5 py-2 text-xs"
                  onClick={() => setFields((f) => ({ ...f, vat_amount: String(Math.round(toNumber(f.supply_amount) * 0.1)) }))}
                  title="공급가액의 10% 로 계산"
                >
                  10%
                </button>
              </div>
            </Field>

            <Field label="합계" required hint="합계를 치면 공급가액·부가세로 자동 분리됩니다">
              <AmountInput
                className="input num text-left"
                placeholder={String(total || '')}
                value={totalDraft}
                onFocus={() => setTotalDraft(String(total || ''))}
                onChange={(e) => {
                  const raw = e.target.value
                  setTotalDraft(raw)
                  const t = toNumber(raw)
                  if (!t) return
                  if (taxFree) {
                    setFields((f) => ({ ...f, supply_amount: String(t), vat_amount: '0' }))
                    return
                  }
                  const supply = Math.round(t / 1.1)
                  setFields((f) => ({ ...f, supply_amount: String(supply), vat_amount: String(t - supply) }))
                }}
                onBlur={() => setTotalDraft('')}
              />
              <p className="mt-1 text-xs tabular-nums text-ink-500">
                공급 {formatKRW(supply)}원 + 세액 {formatKRW(vat)}원 = 합계 {formatKRW(total)}원
              </p>
              <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink-600">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-brand-600"
                  checked={taxFree}
                  onChange={(e) => {
                    const on = e.target.checked
                    setTaxFree(on)
                    if (on) setFields((f) => ({ ...f, vat_amount: '0' }))
                  }}
                />
                면세·영세 (세액 없이 합계 그대로)
              </label>
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={isReport ? '지출자' : '작성자'} hint={isReport ? '지출결의를 올린 사람입니다.' : undefined}>
            {isAdmin ? (
              <select
                className="input"
                value={form.requester_id}
                onChange={set('requester_id')}
                disabled={!isReport && entryType === 'sale'}
              >
                <option value="">선택 안 함</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                    {p.department ? ` · ${p.department}` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="input bg-ink-100"
                value={profiles.find((p) => p.id === (form.requester_id || userId))?.full_name || '본인'}
                readOnly
              />
            )}
          </Field>

          {isAdmin && initial?.id ? (
            <Field label="등록자" hint="입사 전 자료 등 작성자가 다르면 여기서 바로잡습니다.">
              <select className="input" value={form.author_id} onChange={set('author_id')}>
                <option value="">미지정</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                    {p.department ? ` · ${p.department}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field label={isReport ? '지출수단' : '결제수단'}>
            <select className="input" value={form.payment_method} onChange={set('payment_method')}>
              <option value="">선택 안 함</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>

          {form.payment_method === '카드' ? (
            <Field
              label="사용 카드"
              hint="나중에 같은 내역을 카드 파일로 올리면 중복으로 자동 제외됩니다"
            >
              <select
                className="input"
                value={form.card_label}
                onChange={set('card_label')}
              >
                <option value="">선택 안 함</option>
                {fundCards.map((c) => {
                  const last4 = cardLast4(c.number)
                  return (
                    <option key={c.id} value={last4 ? `법카 ${last4}` : ''} disabled={!last4}>
                      {c.issuer} {last4 ? `····${last4}` : ''} {c.name}
                      {c.holder ? ` · ${c.holder}` : ''}
                    </option>
                  )
                })}
              </select>
            </Field>
          ) : null}

          {entryType === 'opex' || entryType === 'purchase' ? (
            <Field label="카드 이용자" hint="여러 명이면 체크, 목록에 없으면 기타에 직접 입력">
              <CardUserSelect
                value={form.card_user}
                onChange={(v) => setFields((f) => ({ ...f, card_user: v }))}
                allowCustom
              />
            </Field>
          ) : null}

          <Field label="비고" className="sm:col-span-2">
            <textarea
              className="input min-h-[72px] resize-y"
              placeholder="추가로 남길 내용"
              value={form.memo}
              onChange={set('memo')}
            />
          </Field>
        </div>

        <Field label="증빙 파일" hint="영수증·세금계산서 등을 첨부할 수 있습니다. (파일당 최대 20MB)">
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-ink-300 bg-white px-4 py-3.5 text-sm font-semibold text-ink-600 transition hover:border-brand-400 hover:bg-brand-50/40">
              <Icon name="upload" size={16} />
              파일 선택
              <input
                type="file"
                multiple
                className="hidden"
                onChange={onPickFiles}
                accept="image/*,.pdf,.hwp,.hwpx,.xls,.xlsx,.doc,.docx,.csv,.txt,.zip"
              />
            </label>

            {existing.map((file) => (
              <div
                key={file.id}
                className="flex items-center gap-3 rounded-lg border border-ink-200 bg-white px-3 py-2"
              >
                <Icon name="paperclip" size={15} className="shrink-0 text-ink-400" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-700">
                  {file.file_name}
                </span>
                <button
                  type="button"
                  className="rounded-md p-1 text-ink-400 transition hover:bg-rose-50 hover:text-loss"
                  onClick={() => removeExisting(file)}
                  aria-label="첨부 삭제"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}

            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center gap-3 rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2"
              >
                <Icon name="paperclip" size={15} className="shrink-0 text-brand-500" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-brand-800">
                  {file.name}
                </span>
                <span className="shrink-0 text-[11px] text-ink-500">{formatFileSize(file.size)}</span>
                <button
                  type="button"
                  className="rounded-md p-1 text-ink-400 transition hover:bg-white hover:text-loss"
                  onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                  aria-label="선택 취소"
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
        </Field>
      </form>
    </Modal>
  )
}

function emptyForm(entryType, source, userId) {
  return {
    doc_no: '',
    entry_date: todayISO(),
    project_id: '',
    counterparty: '',
    category: '',
    description: '',
    supply_amount: '',
    vat_amount: '',
    payment_method: '',
    memo: '',
    card_user: '',
    card_label: '',
    requester_id: source === 'expense_report' || entryType === 'opex' ? userId || '' : '',
    author_id: userId || '',
  }
}

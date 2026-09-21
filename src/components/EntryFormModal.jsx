import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import { Field, InlineAlert, Modal, Spinner } from './ui'
import { useToast } from './Toast'
import { CATEGORIES, ENTRY_META, PAYMENT_METHODS } from '../lib/constants'
import { formatFileSize, formatKRW, todayISO } from '../lib/format'
import { createEntry, deleteAttachment, updateEntry, uploadAttachment } from '../lib/api'

const MAX_FILE = 20 * 1024 * 1024

function toNumber(value) {
  const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? Math.round(n) : 0
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
  isAdmin = false,
  userId = null,
}) {
  const toast = useToast()
  const meta = ENTRY_META[entryType] || ENTRY_META.sale
  const labels = LABELS[entryType] || LABELS.sale
  const isReport = source === 'expense_report'

  const [form, setForm] = useState(() => emptyForm(entryType, source, userId))
  const [files, setFiles] = useState([])
  const [existing, setExisting] = useState([])
  const [removed, setRemoved] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setFiles([])
    setRemoved([])
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
        requester_id: initial.requester_id || userId || '',
      })
      setExisting(initial.attachments || [])
    } else {
      setForm(emptyForm(entryType, source, userId))
      setExisting([])
    }
  }, [open, initial, entryType, source, userId])

  const supply = toNumber(form.supply_amount)
  const vat = toNumber(form.vat_amount)
  const total = supply + vat

  const categoryOptions = useMemo(() => {
    const base = CATEGORIES[entryType] || []
    if (form.category && !base.includes(form.category)) return [form.category, ...base]
    return base
  }, [entryType, form.category])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

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
    if (supply <= 0 && vat <= 0) return setError('금액을 입력해 주세요.')
    if (isReport && !form.requester_id && !userId) return setError('지출자를 선택해 주세요.')

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
        memo: form.memo.trim(),
        requester_id: isReport ? form.requester_id || userId : form.requester_id || null,
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
            {saving ? <Spinner size={15} /> : <Icon name="check" size={15} />}
            {saving ? '저장 중…' : '저장'}
          </button>
        </>
      }
    >
      <form id="entry-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="일자" required>
            <input type="date" className="input" value={form.entry_date} onChange={set('entry_date')} required />
          </Field>

          {isReport ? (
            <Field label="결의번호" hint="비워두면 자동으로 비워둔 채 저장됩니다.">
              <input
                className="input"
                placeholder={`지출-${(form.entry_date || todayISO()).replace(/-/g, '')}`}
                value={form.doc_no}
                onChange={set('doc_no')}
              />
            </Field>
          ) : (
            <Field label="프로젝트" hint="프로젝트별 손익에 반영됩니다.">
              <select className="input" value={form.project_id} onChange={set('project_id')}>
                <option value="">선택 없음</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.code ? ` (${p.code})` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {isReport ? (
            <Field label="프로젝트">
              <select className="input" value={form.project_id} onChange={set('project_id')}>
                <option value="">선택 없음</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.code ? ` (${p.code})` : ''}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          <Field label={labels.party}>
            <input
              className="input"
              placeholder={entryType === 'sale' ? '예: ○○ 주식회사' : '예: □□ 상사'}
              value={form.counterparty}
              onChange={set('counterparty')}
            />
          </Field>

          <Field label={labels.category}>
            <input
              className="input"
              list={`cat-${entryType}`}
              placeholder="목록에서 선택하거나 직접 입력"
              value={form.category}
              onChange={set('category')}
            />
            <datalist id={`cat-${entryType}`}>
              {categoryOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
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
            <Field label="공급가액" required>
              <input
                className="input num text-left"
                inputMode="numeric"
                value={form.supply_amount}
                onChange={set('supply_amount')}
                placeholder="0"
              />
            </Field>

            <Field label="부가세">
              <div className="flex gap-1.5">
                <input
                  className="input num text-left"
                  inputMode="numeric"
                  value={form.vat_amount}
                  onChange={set('vat_amount')}
                  placeholder="0"
                />
                <button
                  type="button"
                  className="btn-ghost shrink-0 whitespace-nowrap px-2.5 py-2 text-xs"
                  onClick={() => setForm((f) => ({ ...f, vat_amount: String(Math.round(toNumber(f.supply_amount) * 0.1)) }))}
                  title="공급가액의 10% 로 계산"
                >
                  10%
                </button>
              </div>
            </Field>

            <Field label="합계">
              <div className="flex h-[42px] items-center justify-end rounded-lg border border-ink-200 bg-white px-3">
                <span className="font-num text-sm font-extrabold tabular-nums text-ink-900">
                  {formatKRW(total)}원
                </span>
              </div>
            </Field>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={isReport ? '지출자' : '담당자'} hint={isReport ? '지출결의를 올린 사람입니다.' : undefined}>
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
    requester_id: source === 'expense_report' ? userId || '' : '',
  }
}

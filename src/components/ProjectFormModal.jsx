import { useEffect, useState } from 'react'
import { Field, InlineAlert, Modal, Spinner } from './ui'
import { useToast } from './Toast'
import { PROJECT_STATUS, PROJECT_STATUS_KEYS, sortManagers } from '../lib/constants'
import { createProject, updateProject } from '../lib/api'

const EMPTY = {
  name: '',
  client: '',
  status: 'active',
  start_date: '',
  end_date: '',
  contract_amount: '',
  profit_rate: '',
  venue: '',
  manager_id: '',
  memo: '',
}

export default function ProjectFormModal({ open, onClose, onSaved, initial, profiles = [], userId }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    if (initial) {
      setForm({
        name: initial.name || '',
        client: initial.client || '',
        status: initial.status || 'active',
        start_date: initial.start_date || '',
        end_date: initial.end_date || '',
        contract_amount: String(initial.contract_amount ?? ''),
        profit_rate: initial.profit_rate ? String(initial.profit_rate) : '',
        venue: initial.venue || '',
        manager_id: initial.manager_id || '',
        memo: initial.memo || '',
      })
    } else {
      setForm(EMPTY)
    }
  }, [open, initial])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('프로젝트명을 입력해 주세요.')

    setSaving(true)
    setError('')
    try {
      const payload = {
        name: form.name.trim(),
        client: form.client.trim(),
        status: form.status,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        contract_amount: Math.round(Number(String(form.contract_amount).replace(/[^0-9.-]/g, '')) || 0),
        profit_rate: Number(String(form.profit_rate).replace(/[^0-9.-]/g, '')) || 0,
        venue: form.venue.trim(),
        manager_id: form.manager_id || null,
        memo: form.memo.trim(),
      }

      if (initial?.id) {
        await updateProject(initial.id, payload)
        toast.success('프로젝트가 수정되었습니다.')
      } else {
        await createProject({ ...payload, created_by: userId })
        toast.success('프로젝트가 등록되었습니다.')
      }
      onSaved?.()
      onClose?.()
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
      title={initial?.id ? '프로젝트 수정' : '프로젝트 등록'}
      subtitle="프로젝트를 지정한 매출·비용은 손익으로 자동 집계됩니다."
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="submit" form="project-form" className="btn-primary" disabled={saving}>
            {saving ? <Spinner size={15} /> : null}
            {saving ? '저장 중…' : '저장'}
          </button>
        </>
      }
    >
      <form id="project-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error ? (
          <div className="sm:col-span-2">
            <InlineAlert tone="error">{error}</InlineAlert>
          </div>
        ) : null}

        <Field label="프로젝트명" required className="sm:col-span-2">
          <input className="input" value={form.name} onChange={set('name')} placeholder="예: 2026 브랜드 리뉴얼" />
        </Field>

        <Field label="발주처 / 고객사">
          <input className="input" value={form.client} onChange={set('client')} placeholder="예: ○○ 주식회사" />
        </Field>

        <Field label="장소">
          <input className="input" value={form.venue} onChange={set('venue')} placeholder="예: BEXCO 제2전시장" />
        </Field>

        <Field label="진행 상태">
          <select className="input" value={form.status} onChange={set('status')}>
            {PROJECT_STATUS_KEYS.map((key) => (
              <option key={key} value={key}>
                {PROJECT_STATUS[key].label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="담당자">
          <select className="input" value={form.manager_id} onChange={set('manager_id')}>
            <option value="">선택 안 함</option>
            {sortManagers(profiles).map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
                {p.department ? ` · ${p.department}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="시작일">
          <input type="date" className="input" value={form.start_date} onChange={set('start_date')} />
        </Field>

        <Field label="종료일">
          <input type="date" className="input" value={form.end_date} onChange={set('end_date')} />
        </Field>

        <Field label="계약 금액" hint="부가세 별도 기준으로 입력해 주세요.">
          <input
            className="input num text-left"
            inputMode="numeric"
            value={form.contract_amount}
            onChange={set('contract_amount')}
            placeholder="0"
          />
        </Field>

        <Field label="목표 수익률 (%)" hint="비워두면 표시하지 않습니다.">
          <input
            className="input num text-left"
            inputMode="decimal"
            value={form.profit_rate}
            onChange={set('profit_rate')}
            placeholder="예: 30"
          />
        </Field>

        <Field label="메모" className="sm:col-span-2">
          <textarea className="input min-h-[72px] resize-y" value={form.memo} onChange={set('memo')} />
        </Field>
      </form>
    </Modal>
  )
}

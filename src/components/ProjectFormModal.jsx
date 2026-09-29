import { useEffect, useState } from 'react'
import { AmountInput, Field, InlineAlert, Modal, Spinner } from './ui'
import { useToast } from './Toast'
import { PROJECT_STATUS, PROJECT_STATUS_KEYS, sortManagers } from '../lib/constants'
import PartnerPicker from './PartnerPicker'
import { contractSplit } from '../lib/format'
import { createProject, ensurePartnerByName, projectContractSplitAvailable, updateProject } from '../lib/api'

const EMPTY = {
  name: '',
  client: '',
  status: 'active',
  start_date: '',
  end_date: '',
  contract_supply: '',
  contract_vat: '',
  contract_total: '',
  venue: '',
  manager_id: '',
  memo: '',
}

const toNum = (v) => Math.round(Number(String(v ?? '').replace(/[^0-9.-]/g, '')) || 0)

export default function ProjectFormModal({ open, onClose, onSaved, initial, profiles = [], userId }) {
  const toast = useToast()
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  /* 분리 컬럼 마이그레이션 전에는 합계 한 칸만 보여줍니다 */
  const [splitOK, setSplitOK] = useState(false)

  useEffect(() => {
    if (!open) return
    setError('')
    projectContractSplitAvailable().then(setSplitOK).catch(() => setSplitOK(false))
    if (initial) {
      const split = contractSplit(initial)
      setForm({
        name: initial.name || '',
        client: initial.client || '',
        status: initial.status || 'active',
        start_date: initial.start_date || '',
        end_date: initial.end_date || '',
        contract_supply: split.supply ? String(split.supply) : '',
        contract_vat: split.vat ? String(split.vat) : '',
        contract_total: split.total ? String(split.total) : '',
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
      const supply = toNum(form.contract_supply)
      const vat = toNum(form.contract_vat)
      const total = supply + vat
      const payload = {
        name: form.name.trim(),
        client: form.client.trim(),
        status: form.status,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        contract_amount: total,
        // 분리 컬럼이 있을 때만 함께 저장합니다 (마이그레이션 전에는 합계만).
        ...(splitOK ? { contract_supply: supply, contract_vat: vat } : {}),
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
      /* 발주처가 대장에 없으면 자동 등록 (표기만 다른 곳은 기존 것으로 연결) */
      if (payload.client) {
        ensurePartnerByName(payload.client, userId).catch(() => {})
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
          <PartnerPicker value={form.client} onChange={set('client')} placeholder="예: ○○ 주식회사" />
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

        <div className="sm:col-span-2 rounded-xl border border-ink-200 bg-ink-50/60 p-4">
          <p className="mb-3 text-xs font-bold text-ink-700">
            계약 금액 {splitOK ? '' : '(합계 한 칸 — 분리 저장은 SQL 1회 실행 후)'}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="공급가액" required={false}>
              <AmountInput
                className="input num text-left"
                value={form.contract_supply}
                onChange={set('contract_supply')}
                placeholder="0"
              />
            </Field>
            <Field label="부가세">
              <div className="flex gap-1.5">
                <AmountInput
                  className="input num text-left"
                  value={form.contract_vat}
                  onChange={set('contract_vat')}
                  placeholder="0"
                />
                <button
                  type="button"
                  className="btn-ghost shrink-0 whitespace-nowrap px-2.5 py-2 text-xs"
                  onClick={() =>
                    setForm((f) => ({ ...f, contract_vat: String(Math.round(toNum(f.contract_supply) * 0.1)) }))
                  }
                  title="공급가액의 10%로 계산"
                >
                  10%
                </button>
              </div>
            </Field>
            <Field label="합계" hint="합계를 치면 공급가액·부가세로 자동 분리됩니다">
              <AmountInput
                className="input num text-left"
                value={form.contract_total}
                placeholder={String(toNum(form.contract_supply) + toNum(form.contract_vat) || '')}
                onChange={(e) => {
                  const raw = e.target.value
                  setForm((f) => ({ ...f, contract_total: raw }))
                  const t = toNum(raw)
                  if (!t) return
                  const supply = Math.round(t / 1.1)
                  setForm((f) => ({ ...f, contract_supply: String(supply), contract_vat: String(t - supply) }))
                }}
                onBlur={() =>
                  setForm((f) => ({ ...f, contract_total: String(toNum(f.contract_supply) + toNum(f.contract_vat) || '') }))
                }
              />
            </Field>
          </div>
          {!splitOK ? (
            <p className="mt-2 text-[11px] text-ink-500">
              분리 저장을 쓰려면 Supabase SQL Editor에서 <code>supabase/migration_projects_contract.sql</code>을
              1회 실행하세요. 그 전에는 합계만 저장됩니다.
            </p>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <InlineAlert tone="info">
            <strong>수익·수익률은 직접 입력하지 않습니다.</strong> 장부의 매출 − (매입 + 운영비)로 자동
            계산되고, 수익률은 이를 매출로 나눈 값입니다. 제안서·미진행도 마찬가지여서 매출이 없으면
            투입비용만큼 손실로 표시됩니다. (프로젝트 카드·상세 화면에 바로 반영됩니다)
          </InlineAlert>
        </div>

        <Field label="메모" className="sm:col-span-2">
          <textarea className="input min-h-[72px] resize-y" value={form.memo} onChange={set('memo')} />
        </Field>
      </form>
    </Modal>
  )
}

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import PartnerPicker from './PartnerPicker'
import { AmountInput, Field, InlineAlert, Modal } from './ui'
import { useToast } from './Toast'
import { formatKRW } from '../lib/format'
import { createEntry, createProject, deleteProject, linkProjectPartner, listPartners, unlinkProjectPartner, updateProject } from '../lib/api'
import { normalizeVendorName } from '../lib/format'

/* 대행계약 전용 등록/수정 모달 */
export default function AgencyDealModal({ partners, userId, initial = null, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState({
    name: initial?.project?.name || '',
    client: initial?.project?.client || '',
    agencyName: (() => {
      if (!initial?.partnerId) return ''
      return (partners || []).find((p) => p.id === initial.partnerId)?.name || ''
    })(),
    total: (() => {
      if (!initial?.project) return ''
      const m = String(initial.project.memo || '').match(/총계약\s*([\d,]+)\s*원/)
      return m ? m[1].replace(/,/g, '') : String(initial.project.contract_amount || '')
    })(),
    fee: (() => {
      if (!initial?.project) return ''
      const m = String(initial.project.memo || '').match(/수수료\s*([\d,]+)\s*원/)
      return m ? m[1].replace(/,/g, '') : String(initial.project.agency_fee || initial.project.contract_amount || '')
    })(),
    agencyStatus: initial?.project?.agency_status || '계약전',
    start: initial?.project?.start_date || '',
    end: initial?.project?.end_date || '',
    memo: initial?.project?.memo || '',
  })
  const [feeTouched, setFeeTouched] = useState(Boolean(initial))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const set = (key, transform) => (e) => {
    const v = transform ? transform(e.target.value) : e.target.value
    setForm((f) => {
      const next = { ...f, [key]: v }
      if ((key === 'total' || key === 'fee') && !feeTouched) {
        const t = Number(String(next.total).replace(/[^0-9]/g, '')) || 0
        const r = Number(next.fee).replace(/[^0-9]/g, '') || 0
        if (t && r) next.fee = String(Math.round((t * r) / 100))
      }
      return next
    })
  }

  const feeNum = Number(String(form.fee).replace(/[^0-9]/g, '')) || 0
  const totalNum = Number(String(form.total).replace(/[^0-9]/g, '')) || 0

  const handleDelete = async () => {
    if (!initial?.project?.id) return
    if (!window.confirm('정말로 이 대행계약을 삭제하시겠습니까?\n해당 프로젝트와 연결된 모든 내역이 함께 삭제됩니다.')) return
    setDeleting(true)
    setError('')
    try {
      if (initial.partnerId) {
        await unlinkProjectPartner(initial.project.id, initial.partnerId).catch(() => {})
      }
      await deleteProject(initial.project.id, user?.id)
      toast.success('대행계약을 삭제했습니다.')
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return setError('행사이름을 입력해 주세요.')
    if (!form.client.trim()) return setError('발주처를 입력해 주세요.')
    if (!form.agencyName.trim()) return setError('대행업체를 입력해 주세요.')
    setSaving(true)
    setError('')
    try {
      const allPartners = await listPartners().catch(() => partners)
      const target = normalizeVendorName(form.agencyName.trim())
      const partner = (allPartners || []).find((p) => normalizeVendorName(p.name) === target)
      if (!partner) return setError('대행업체를 먼저 등록해 주세요 (입력창에서 + 새로 등록).')

      if (initial?.project?.id) {
        await updateProject(initial.project.id, {
          name: form.name.trim(),
          client: form.client.trim(),
          start_date: form.start || null,
          end_date: form.end || null,
          contract_amount: totalNum,
          agency_fee: feeNum,
          agency_status: form.agencyStatus,
          memo: form.memo.trim(),
        })
        if (initial.partnerId && initial.partnerId !== partner.id) {
          await unlinkProjectPartner(initial.project.id, initial.partnerId).catch(() => {})
        }
        await linkProjectPartner(initial.project.id, partner.id, userId, '대행')
        toast.success('대행계약을 수정했습니다.')
        onSaved?.()
        return
      }

      const project = await createProject({
        name: form.name.trim(),
        client: form.client.trim(),
        venue: '',
        status: 'active',
        start_date: form.start || null,
        end_date: form.end || null,
        contract_amount: totalNum,
        agency_fee: feeNum,
        agency_status: form.agencyStatus,
        memo: [
          `대행계약 ${formatKRW(totalNum)}원 (수수료 ${formatKRW(feeNum)}원, 수행 ${partner.name}, 나머지 ${formatKRW(totalNum - feeNum)}원 전달)`,
          String(form.memo || '').trim(),
        ]
          .filter(Boolean)
          .join('\n'),
      })
      await linkProjectPartner(project.id, partner.id, userId, '대행')
      let clientMissing = false
      if (form.client.trim()) {
        const all2 = await listPartners().catch(() => partners)
        clientMissing = !(all2 || []).some(
          (p) => normalizeVendorName(p.name) === normalizeVendorName(form.client.trim()),
        )
      }
      if (feeNum > 0) {
        const supply = Math.round(feeNum / 1.1)
        await createEntry(
          {
            entry_date: form.start || new Date().toISOString().slice(0, 10),
            counterparty: form.client.trim(),
            project_id: project.id,
            category: '용역매출',
            description: `대행 수수료 (총계약 ${formatKRW(totalNum)}원)`,
            supply_amount: supply,
            vat_amount: feeNum - supply,
            payment_method: '계좌이체',
            memo: '대행계약 수수료 매출',
            entry_type: 'sale',
          },
          userId,
        )
      }
      toast.success(
        clientMissing
          ? '대행계약을 등록했습니다. 발주처는 목록에서 + 새로 등록으로 추가해 주세요.'
          : '대행계약을 등록했습니다.',
      )
      onSaved?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={saving || deleting ? undefined : onClose}
      title={initial?.project?.id ? '대행계약 수정' : '대행계약 등록'}
      subtitle="총계약액(입금) 중 수수료만 매출로 잡고, 나머지는 대행업체에 전달됩니다."
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving || deleting}>
            취소
          </button>
          {initial?.project?.id ? (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="btn-ghost text-loss hover:bg-rose-50 hover:text-loss"
            >
              {deleting ? '삭제 중…' : '삭제'}
            </button>
          ) : null}
          <button type="submit" form="agency-deal-form" className="btn-primary" disabled={saving || deleting}>
            {saving || deleting ? '저장 중…' : initial?.project?.id ? '수정' : '등록'}
          </button>
        </>
      }
    >
      <form id="agency-deal-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error ? (
          <div className="sm:col-span-2">
            <InlineAlert tone="error">{error}</InlineAlert>
          </div>
        ) : null}
        <Field label="행사이름" required className="sm:col-span-2">
          <input className="input" value={form.name} onChange={set('name')} placeholder="예: BMICE 인증제 관광 개발 컨설팅 및 운영" />
        </Field>
        <Field label="발주처 (원청)" required>
          <PartnerPicker value={form.client} onChange={set('client')} placeholder="예: 부산관광고등학교" userId={userId} />
        </Field>
        <Field label="대행업체 (실제 수행사)" required hint="치면 검색되고, 없으면 + 새로 등록으로 추가하세요">
          <PartnerPicker value={form.agencyName} onChange={set('agencyName')} placeholder="예: (사)부산컨벤션산업협회" userId={userId} />
        </Field>
        <Field label="총계약액 (원, VAT포함)" hint="발주처로부터 입금받는 전체 금액 (부가세포함)">
          <AmountInput
            className="input text-right font-num tabular-nums"
            value={form.total}
            onChange={set('total')}
            placeholder="예: 49880000"
          />
        </Field>
        <Field label="수수료액 (원, VAT포함)" hint="총계약액 중 우리 회사 매출로 잡을 금액">
          <AmountInput
            className="input text-right font-num tabular-nums"
            value={form.fee}
            onChange={(e) => {
              setFeeTouched(true)
              set('fee')(e)
            }}
            placeholder="예: 1496400"
          />
        </Field>
        <Field label="대금집행 상태" hint="계약 전 → 계약 중 → 입금완료 → 정산중 → 지급완료">
          <select className="input" value={form.agencyStatus} onChange={set('agencyStatus')}>
            <option value="계약전">계약전</option>
            <option value="계약중">계약중</option>
            <option value="입금완료">입금완료 (발주처 입금)</option>
            <option value="정산중">정산중 (수수료 정산 중)</option>
            <option value="지급완료">지급완료 (대행업체 지급 완료)</option>
          </select>
        </Field>
        <Field label="시작일">
          <input type="date" className="input" value={form.start} onChange={set('start')} />
        </Field>
        <Field label="종료일">
          <input type="date" className="input" value={form.end} onChange={set('end')} />
        </Field>
        <Field label="메모" className="sm:col-span-2">
          <textarea className="input min-h-[64px] resize-y" value={form.memo} onChange={set('memo')} />
        </Field>
      </form>
    </Modal>
  )
}

import { useState } from 'react'
import PartnerPicker from './PartnerPicker'
import { AmountInput, Field, InlineAlert, Modal } from './ui'
import { useToast } from './Toast'
import { formatKRW } from '../lib/format'
import { createEntry, createProject, deleteProject, linkProjectPartner, listEntries, listPartners, unlinkProjectPartner, updateEntry, updateProject } from '../lib/api'
import { normalizeVendorName } from '../lib/format'

/** 대행 수수료 매출에 쓰는 비목 (행사대행업 기준) */
const FEE_CATEGORY = '행사대행수수료'
const FEE_MEMO = '대행계약 수수료 매출'

/** 대행계약 요약 줄을 새로 만들고, 사용자가 적은 나머지 메모는 그대로 둡니다. */
function buildAgencyMemo(prev, totalNum, feeNum, partnerName) {
  const summary = [
    `대행계약: 총계약 ${formatKRW(totalNum)}원 중 수수료 ${formatKRW(feeNum)}원만 매출.`,
    `수행 ${partnerName} (나머지 ${formatKRW(Math.max(0, totalNum - feeNum))}원 전달).`,
  ].join('\n')
  const rest = String(prev || '')
    .split('\n')
    .filter((line) => !/^\s*(대행계약:|총계약|수행\s)/.test(line))
    .join('\n')
    .trim()
  return rest ? `${summary}\n${rest}` : summary
}

/* 대행계약 전용 등록/수정 모달 */
export default function AgencyDealModal({ partners, userId, initial = null, onClose, onSaved }) {
  const toast = useToast()

  /* 수정 모드 초기값: 저장된 금액 컬럼을 우선 쓰고, 없으면 메모에서 복원합니다. */
  const init = (() => {
    const p = initial?.project
    if (!p) return { total: '', rate: '3', fee: '' }
    const memo = String(p.memo || '')
    const mTotal = memo.match(/총계약\s*([\d,]+)\s*원/)
    const mFee = memo.match(/수수료(?:액)?\s*([\d,]+)\s*원/)
    const mRate = memo.match(/수수료(?:율)?\s*([\d.]+)\s*%/)
    const total = Number(p.contract_amount) > 0
      ? String(p.contract_amount)
      : mTotal ? mTotal[1].replace(/,/g, '') : ''
    const fee = Number(p.agency_fee) > 0
      ? String(p.agency_fee)
      : mFee ? mFee[1].replace(/,/g, '') : ''
    const t = Number(String(total).replace(/[^0-9]/g, '')) || 0
    const f = Number(String(fee).replace(/[^0-9]/g, '')) || 0
    const rate = t > 0 && f > 0
      ? String(Math.round((f / t) * 10000) / 100)
      : mRate ? mRate[1] : '3'
    return { total, rate, fee }
  })()

  const [form, setForm] = useState({
    name: initial?.project?.name || '',
    client: initial?.project?.client || '',
    agencyName: (() => {
      if (!initial?.partnerId) return ''
      return (partners || []).find((p) => p.id === initial.partnerId)?.name || ''
    })(),
    total: init.total,
    rate: init.rate,
    fee: init.fee,
    agencyStatus: initial?.project?.agency_status || '계약전',
    start: initial?.project?.start_date || '',
    end: initial?.project?.end_date || '',
    memo: initial?.project?.memo || '',
  })
  /* 수수료액을 직접 고친 뒤에는 수수료율·총계약을 바꿔도 자동 계산하지 않습니다. */
  const [feeManual, setFeeManual] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const digits = (v) => Number(String(v ?? '').replace(/[^0-9]/g, '')) || 0
  const calcFee = (totalVal, rateVal) => {
    const t = digits(totalVal)
    const r = Number(String(rateVal ?? '').replace(/[^0-9.]/g, '')) || 0
    if (!t || !r) return ''
    return String(Math.round((t * r) / 100))
  }

  const set = (key, transform) => (e) => {
    const v = transform ? transform(e.target.value) : e.target.value
    setForm((f) => ({ ...f, [key]: v }))
  }

  /* 총계약액: 수수료액을 직접 고치지 않았으면 수수료율로 다시 계산 */
  const onTotalChange = (e) => {
    const v = e.target.value
    setForm((f) => {
      const next = { ...f, total: v }
      if (!feeManual) {
        const calc = calcFee(v, next.rate)
        if (calc) next.fee = calc
      }
      return next
    })
  }

  /* 수수료율: 항상 총계약액 × 요율로 수수료액을 다시 계산 */
  const onRateChange = (e) => {
    const v = String(e.target.value ?? '').replace(/[^0-9.]/g, '')
    setFeeManual(false)
    setForm((f) => {
      const next = { ...f, rate: v }
      const calc = calcFee(next.total, v)
      if (calc) next.fee = calc
      return next
    })
  }

  /* 수수료액 직접 입력: 요율 표시도 함께 맞춰 줍니다 */
  const onFeeChange = (e) => {
    const v = e.target.value
    setFeeManual(true)
    setForm((f) => {
      const next = { ...f, fee: v }
      const t = digits(next.total)
      const fee = digits(v)
      if (t > 0 && fee > 0) next.rate = String(Math.round((fee / t) * 10000) / 100)
      return next
    })
  }

  const feeNum = digits(form.fee)
  const totalNum = digits(form.total)

  const handleDelete = async () => {
    if (!initial?.project?.id) return
    if (!window.confirm('정말로 이 대행계약을 삭제하시겠습니까?\n해당 프로젝트와 연결된 모든 내역이 함께 삭제됩니다.')) return
    setDeleting(true)
    setError('')
    try {
      if (initial.partnerId) {
        await unlinkProjectPartner(initial.project.id, initial.partnerId).catch(() => {})
      }
      await deleteProject(initial.project.id, userId)
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
    if (totalNum > 0 && feeNum > totalNum) {
      return setError('수수료액이 총계약액보다 클 수 없습니다.')
    }
    setSaving(true)
    setError('')
    try {
      const allPartners = await listPartners().catch(() => partners)
      const target = normalizeVendorName(form.agencyName.trim())
      const partner = (allPartners || []).find((p) => normalizeVendorName(p.name) === target)
      if (!partner) {
        setError('대행업체를 먼저 등록해 주세요 (입력창에서 + 새로 등록).')
        return
      }

      /* 수수료 매출 장부 1건 (총계약 중 우리 몫). VAT 포함 금액을 공급가/부가세로 나눕니다. */
      const feePayload = () => {
        const supply = Math.round(feeNum / 1.1)
        return {
          entry_date: form.start || new Date().toISOString().slice(0, 10),
          counterparty: form.client.trim(),
          category: FEE_CATEGORY,
          description: `대행 수수료 (총계약 ${formatKRW(totalNum)}원)`,
          supply_amount: supply,
          vat_amount: feeNum - supply,
          payment_method: '계좌이체',
          memo: FEE_MEMO,
          entry_type: 'sale',
        }
      }

      if (initial?.project?.id) {
        await updateProject(initial.project.id, {
          name: form.name.trim(),
          client: form.client.trim(),
          start_date: form.start || null,
          end_date: form.end || null,
          contract_amount: totalNum,
          agency_fee: feeNum,
          agency_status: form.agencyStatus,
          memo: buildAgencyMemo(form.memo, totalNum, feeNum, partner.name),
        })
        if (initial.partnerId && initial.partnerId !== partner.id) {
          await unlinkProjectPartner(initial.project.id, initial.partnerId).catch(() => {})
        }
        await linkProjectPartner(initial.project.id, partner.id, userId, '대행')

        /* 수수료액이 바뀌면 기존 수수료 매출 장부도 같이 맞춥니다 (중복 생성 방지). */
        if (feeNum > 0) {
          const sales = await listEntries({ projectId: initial.project.id, types: ['sale'] }).catch(() => [])
          const feeEntry = (sales || []).find(
            (en) => en.memo === FEE_MEMO || String(en.description || '').startsWith('대행 수수료'),
          )
          if (feeEntry) {
            await updateEntry(feeEntry.id, feePayload())
          } else {
            await createEntry({ ...feePayload(), project_id: initial.project.id }, userId)
          }
        }
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
        memo: buildAgencyMemo(form.memo, totalNum, feeNum, partner.name),
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
        await createEntry({ ...feePayload(), project_id: project.id }, userId)
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
            onChange={onTotalChange}
            placeholder="예: 49880000"
          />
        </Field>
        <Field
          label="수수료율 (%)"
          hint={feeNum > 0 ? `수수료액 ${formatKRW(feeNum)}원으로 자동 계산됩니다` : '총계약액 × 수수료율로 수수료액이 자동 계산됩니다'}
        >
          <input
            type="text"
            inputMode="decimal"
            className="input text-right font-num tabular-nums"
            value={form.rate}
            onChange={onRateChange}
            placeholder="예: 3"
          />
        </Field>
        <Field label="수수료액 (원, VAT포함)" hint="자동 계산된 금액입니다. 특약이 있으면 직접 고치세요" className="sm:col-span-2">
          <AmountInput
            className="input text-right font-num tabular-nums"
            value={form.fee}
            onChange={onFeeChange}
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

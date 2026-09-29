import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CardImport from './CardImport'
import Icon from '../components/Icon'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, Field, LoadingBlock, Modal, PageHeader, SegmentedControl, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { formatKRW, todayISO } from '../lib/format'
import { deleteFundRow, listBankTransactions, listEntries, listFundRows, saveFundRow, upsertSnapshot } from '../lib/api'
import { vatEstimateByFiling } from '../lib/tax'

/**
 * 자금관리 (관리자 전용).
 * 거래내역은 장부·법인카드에 있으니 여기서는 상태만 봅니다.
 * - 계좌·대출·카드 마스터 + 잔고 스냅샷(이력)
 * - 카드번호는 뒤 4자리만 보여줍니다. CVC는 DB에 저장하지 않습니다.
 */

export function maskCardNo(number) {
  const digits = String(number || '').replace(/[^0-9]/g, '')
  if (!digits) return '—'
  if (digits.length <= 4) return digits
  return `••••-••••-••••-${digits.slice(-4)}`
}

/** 매월 납입일 기준 다음 상환일 (월말 없는 달은 말일로) */
export function nextPayDate(payDay, from = new Date()) {
  const y = from.getFullYear()
  const m = from.getMonth()
  const lastDay = new Date(y, m + 1, 0).getDate()
  const d = Math.min(Math.max(1, Number(payDay) || 1), lastDay)
  const thisMonth = new Date(y, m, d)
  if (thisMonth >= new Date(y, m, from.getDate())) return thisMonth
  const ny = m === 11 ? y + 1 : y
  const nm = m === 11 ? 0 : m + 1
  const nlast = new Date(ny, nm + 1, 0).getDate()
  return new Date(ny, nm, Math.min(d, nlast))
}

function fmtDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export default function Funds() {
  const { isAdmin, user } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [accounts, setAccounts] = useState([])
  const [loans, setLoans] = useState([])
  const [cards, setCards] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [reloadKey, setReloadKey] = useState(0)

  const [editKind, setEditKind] = useState(null)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [snapOpen, setSnapOpen] = useState(false)
  /* 자금현황 | 홈택스 | 법인카드 내역 탭 (?tab=cards|hometax 지원) */
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = ['cards', 'hometax'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'overview'
  const setTab = (t) => {
    if (t === 'overview') {
      searchParams.delete('tab')
      setSearchParams(searchParams, { replace: true })
    } else {
      setSearchParams({ tab: t }, { replace: true })
    }
  }

  /* 계좌 거래내역 모달 */
  const [acctTx, setAcctTx] = useState(null)
  const openAccountTx = async (acct) => {
    setAcctTx({ acct, rows: null })
    try {
      const rows = await listBankTransactions(acct.acct_no, { limit: 500 })
      setAcctTx({ acct, rows: rows || [] })
    } catch (error) {
      toast.error(error.message)
      setAcctTx(null)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, l, c, s] = await Promise.all([
        listFundRows('fund_accounts'),
        listFundRows('fund_loans'),
        listFundRows('fund_cards'),
        listFundRows('fund_snapshots'),
      ])
      setAccounts(a || [])
      setLoans(l || [])
      setCards(c || [])
      setSnapshots(s || [])
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const latest = snapshots[0] || null
  const balances = useMemo(() => latest?.balances || {}, [latest])
  const balanceOf = (id) => Number(balances[id] ?? 0)

  const totalBalance = useMemo(
    () => accounts.reduce((a, c) => a + balanceOf(c.id), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, balances],
  )
  const totalDebt = useMemo(() => loans.reduce((a, l) => a + Number(l.balance || 0), 0), [loans])

  const nextPay = useMemo(() => {
    if (!loans.length) return null
    const items = loans.map((l) => ({ loan: l, date: nextPayDate(l.pay_day) }))
    items.sort((a, b) => a.date - b.date)
    return items[0]
  }, [loans])

  const openNew = (kind) => {
    setEditKind(kind)
    setEditing(null)
  }

  const handleDelete = async () => {
    if (!removing) return
    setBusy(true)
    try {
      const table =
        removing.kind === 'loan' ? 'fund_loans' : removing.kind === 'card' ? 'fund_cards' : 'fund_snapshots'
      await deleteFundRow(table, removing.id)
      toast.success('삭제되었습니다.')
      setRemoving(null)
      setReloadKey((k) => k + 1)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="자금관리"
        description="계좌·대출·카드 현황과 잔고 스냅샷입니다. 카드 이용내역은 법인카드 탭에서 올립니다."
      >
        <SegmentedControl
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { key: 'overview', label: '자금현황' },
            { key: 'hometax', label: '홈택스' },
            { key: 'cards', label: '법인카드 내역' },
          ]}
        />
        {isAdmin && tab === 'overview' ? (
          <button type="button" className="btn-primary" onClick={() => setSnapOpen(true)}>
            <Icon name="plus" size={16} />
            잔고 기록
          </button>
        ) : null}
      </PageHeader>

      {tab === 'cards' ? (
        <CardImport embed />
      ) : tab === 'hometax' ? (
        <HometaxPanel />
      ) : loading ? (
        <LoadingBlock />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard
              label="총 잔고"
              value={totalBalance}
              tone="neutral"
              icon="coins"
              hint={latest ? `${latest.snap_date} 기준` : '잔고 기록 없음'}
            />
            <StatCard label="대출잔액 합계" value={totalDebt} tone="loss" icon="card" hint={`${loans.length}건`} />
            <StatCard
              label="순자금"
              value={totalBalance - totalDebt}
              tone={totalBalance - totalDebt >= 0 ? 'profit' : 'loss'}
              icon="chart"
              hint="잔고 − 대출"
            />
            <StatCard
              label="다음 상환"
              value={nextPay ? nextPay.loan.monthly_pay : 0}
              tone="opex"
              icon="calendar"
              hint={nextPay ? `${fmtDate(nextPay.date)} · ${nextPay.loan.bank.split(' ')[0]}` : '대출 없음'}
            />
          </div>

          {latest && latest.memo ? (
            <p className="text-xs text-ink-500">
              최근 스냅샷({latest.snap_date}): {latest.memo}
            </p>
          ) : null}

          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">법인계좌 ({accounts.length}개)</h2>
              {isAdmin ? (
                <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => openNew('account')}>
                  <Icon name="plus" size={14} />
                  계좌 추가
                </button>
              ) : null}
            </header>
            {accounts.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-xs">
                  <thead className="bg-ink-50/70">
                    <tr>
                      <th className="th">은행</th>
                      <th className="th">계좌번호</th>
                      <th className="th">상품명</th>
                      <th className="th text-right">현재잔고</th>
                      <th className="th">비고</th>
                      {isAdmin ? <th className="th text-right">관리</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {accounts.map((a) => (
                      <tr key={a.id} className="transition hover:bg-ink-50/60">
                        <td className="td whitespace-nowrap font-semibold">
                          <button
                            type="button"
                            onClick={() => openAccountTx(a)}
                            className="text-left hover:text-brand-700 hover:underline"
                            title="거래내역 보기"
                          >
                            {a.bank}
                          </button>
                        </td>
                        <td className="td whitespace-nowrap font-num tabular-nums">
                          <button
                            type="button"
                            onClick={() => openAccountTx(a)}
                            className="hover:text-brand-700 hover:underline"
                            title="거래내역 보기"
                          >
                            {a.acct_no}
                          </button>
                        </td>
                        <td className="td">{a.product}</td>
                        <td className="td num font-bold">{formatKRW(balanceOf(a.id))}</td>
                        <td className="td max-w-[260px] truncate text-ink-500" title={a.note}>{a.note || '—'}</td>
                        {isAdmin ? (
                          <td className="td num whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => { setEditKind('account'); setEditing(a) }}
                              className="mr-2 text-xs font-semibold text-brand-700 hover:underline"
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              onClick={() => setRemoving({ kind: 'account', id: a.id, label: `${a.bank} ${a.acct_no}` })}
                              className="text-xs font-semibold text-loss hover:underline"
                            >
                              삭제
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="coins" title="등록된 계좌가 없습니다" />
            )}
          </section>

          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">대출 ({loans.length}건)</h2>
              {isAdmin ? (
                <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => openNew('loan')}>
                  <Icon name="plus" size={14} />
                  대출 추가
                </button>
              ) : null}
            </header>
            {loans.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-xs">
                  <thead className="bg-ink-50/70">
                    <tr>
                      <th className="th">은행</th>
                      <th className="th">상품</th>
                      <th className="th">기간</th>
                      <th className="th text-right">한도</th>
                      <th className="th text-right">잔액</th>
                      <th className="th text-right">납입일</th>
                      <th className="th text-right">월상환액</th>
                      <th className="th text-right">다음납입</th>
                      <th className="th">비고</th>
                      {isAdmin ? <th className="th text-right">관리</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {loans.map((l) => (
                      <tr key={l.id} className="transition hover:bg-ink-50/60">
                        <td className="td whitespace-nowrap font-semibold">{l.bank}</td>
                        <td className="td max-w-[220px] truncate" title={l.product}>{l.product}</td>
                        <td className="td whitespace-nowrap text-ink-500">{l.period || '—'}</td>
                        <td className="td num">{formatKRW(l.limit_amount)}</td>
                        <td className="td num font-bold text-loss">{formatKRW(l.balance)}</td>
                        <td className="td num">매월 {l.pay_day}일</td>
                        <td className="td num">{formatKRW(l.monthly_pay)}</td>
                        <td className="td num font-semibold text-brand-700">{fmtDate(nextPayDate(l.pay_day))}</td>
                        <td className="td max-w-[220px] truncate text-ink-500" title={l.note}>{l.note || '—'}</td>
                        {isAdmin ? (
                          <td className="td num whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => { setEditKind('loan'); setEditing(l) }}
                              className="mr-2 text-xs font-semibold text-brand-700 hover:underline"
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              onClick={() => setRemoving({ kind: 'loan', id: l.id, label: `${l.bank} ${l.product}` })}
                              className="text-xs font-semibold text-loss hover:underline"
                            >
                              삭제
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="card" title="등록된 대출이 없습니다" />
            )}
          </section>

          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">법인카드 ({cards.length}종)</h2>
              {isAdmin ? (
                <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => openNew('card')}>
                  <Icon name="plus" size={14} />
                  카드 추가
                </button>
              ) : null}
            </header>
            {cards.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-xs">
                  <thead className="bg-ink-50/70">
                    <tr>
                      <th className="th">발급사</th>
                      <th className="th">카드명</th>
                      <th className="th">카드번호</th>
                      <th className="th">유효기일</th>
                      <th className="th">보관</th>
                      <th className="th">비고</th>
                      {isAdmin ? <th className="th text-right">관리</th> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {cards.map((c) => (
                      <tr key={c.id} className="transition hover:bg-ink-50/60">
                        <td className="td whitespace-nowrap font-semibold">{c.issuer}</td>
                        <td className="td">{c.name}</td>
                        <td className="td whitespace-nowrap font-num tabular-nums">{maskCardNo(c.number)}</td>
                        <td className="td whitespace-nowrap">{c.expiry || '—'}</td>
                        <td className="td whitespace-nowrap">{c.holder || '—'}</td>
                        <td className="td max-w-[220px] truncate text-ink-500" title={c.note}>{c.note || '—'}</td>
                        {isAdmin ? (
                          <td className="td num whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => { setEditKind('card'); setEditing(c) }}
                              className="mr-2 text-xs font-semibold text-brand-700 hover:underline"
                            >
                              수정
                            </button>
                            <button
                              type="button"
                              onClick={() => setRemoving({ kind: 'card', id: c.id, label: `${c.issuer} ${c.name}` })}
                              className="text-xs font-semibold text-loss hover:underline"
                            >
                              삭제
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon="card" title="등록된 카드가 없습니다" />
            )}
          </section>

          <section className="card overflow-hidden">
            <header className="border-b border-ink-200 px-4 py-3.5">
              <h2 className="text-sm font-bold text-ink-900">잔고 이력 ({snapshots.length}건)</h2>
            </header>
            {snapshots.length ? (
              <ul className="divide-y divide-ink-100">
                {snapshots.map((s) => {
                  const total = Object.values(s.balances || {}).reduce((a, v) => a + Number(v || 0), 0)
                  return (
                    <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="w-24 shrink-0 text-xs font-semibold text-ink-500">{s.snap_date}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-600">{s.memo || '—'}</span>
                      <span className="shrink-0 font-num text-sm font-extrabold tabular-nums text-ink-900">
                        {formatKRW(total)}원
                      </span>
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => setRemoving({ kind: 'snapshot', id: s.id, label: `${s.snap_date} 잔고` })}
                          className="shrink-0 rounded-md p-1.5 text-ink-400 transition hover:bg-rose-50 hover:text-loss"
                          aria-label="삭제"
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <EmptyState icon="chart" title="잔고 기록이 없습니다" description="잔고 기록으로 오늘 잔액을 남기세요." />
            )}
          </section>
        </>
      )}

      {editKind ? (
        <FundModal
          kind={editKind}
          initial={editing}
          onClose={() => { setEditKind(null); setEditing(null) }}
          onSaved={() => { setEditKind(null); setEditing(null); setReloadKey((k) => k + 1) }}
          userId={user?.id}
        />
      ) : null}

      {snapOpen ? (
        <SnapshotModal
          accounts={accounts}
          latest={latest}
          onClose={() => setSnapOpen(false)}
          onSaved={() => { setSnapOpen(false); setReloadKey((k) => k + 1) }}
          userId={user?.id}
        />
      ) : null}

      {acctTx ? (
        <AccountTxModal acct={acctTx.acct} rows={acctTx.rows} onClose={() => setAcctTx(null)} />
      ) : null}

      <ConfirmDialog
        open={Boolean(removing)}
        busy={busy}
        title="삭제하시겠습니까?"
        message={removing ? removing.label : ''}
        onClose={() => setRemoving(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}

const KIND_META = {
  account: {
    table: 'fund_accounts',
    title: '계좌',
    fields: [
      { key: 'bank', label: '은행', placeholder: '예: 부산' },
      { key: 'acct_no', label: '계좌번호', placeholder: '예: 101-2037-7649-07' },
      { key: 'product', label: '상품명', placeholder: '예: 주거래계좌' },
      { key: 'note', label: '비고', placeholder: '예: ID / 용도' },
    ],
  },
  loan: {
    table: 'fund_loans',
    title: '대출',
    fields: [
      { key: 'bank', label: '은행', placeholder: '예: 부산은행 부전동지점' },
      { key: 'product', label: '상품', placeholder: '예: 동백피움 보증대출' },
      { key: 'period', label: '기간', placeholder: '예: 2024.05.03~2029.04.25' },
      { key: 'limit_amount', label: '한도', number: true },
      { key: 'balance', label: '잔액', number: true },
      { key: 'pay_day', label: '납입일(매월)', number: true, placeholder: '예: 25' },
      { key: 'monthly_pay', label: '월상환액', number: true },
      { key: 'note', label: '비고' },
    ],
  },
  card: {
    table: 'fund_cards',
    title: '카드',
    fields: [
      { key: 'issuer', label: '발급사', placeholder: '예: 부산은행' },
      { key: 'name', label: '카드명', placeholder: '예: Favor Company(법인)' },
      { key: 'number', label: '카드번호', placeholder: '예: 6541-3211-9406-9988' },
      { key: 'expiry', label: '유효기일', placeholder: '예: 03/26' },
      { key: 'holder', label: '보관', placeholder: '예: 공용 / 보람팀장 보관' },
      { key: 'note', label: '비고', placeholder: '예: 분실 신고완' },
    ],
  },
}

function FundModal({ kind, initial, onClose, onSaved, userId }) {
  const toast = useToast()
  const meta = KIND_META[kind]
  const [form, setForm] = useState(() => {
    const base = {}
    for (const f of meta.fields) base[f.key] = initial?.[f.key] ?? ''
    return base
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!meta) return null

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = { ...form }
      for (const f of meta.fields) {
        if (f.number) payload[f.key] = Math.round(Number(String(form[f.key]).replace(/[^0-9.-]/g, '')) || 0)
        else payload[f.key] = String(form[f.key] || '').trim()
      }
      if (initial?.id) payload.id = initial.id
      await saveFundRow(meta.table, payload, userId)
      toast.success(`저장되었습니다.`)
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
      onClose={saving ? undefined : onClose}
      title={`${meta.title} ${initial?.id ? '수정' : '등록'}`}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="submit" form="fund-form" className="btn-primary" disabled={saving}>
            저장
          </button>
        </>
      }
    >
      <form id="fund-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {error ? (
          <div className="sm:col-span-2 text-sm font-medium text-loss">{error}</div>
        ) : null}
        {meta.fields.map((f) => (
          <Field key={f.key} label={f.label}>
            <input
              className="input"
              inputMode={f.number ? 'numeric' : undefined}
              value={form[f.key]}
              onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder || ''}
            />
          </Field>
        ))}
        {kind === 'card' ? (
          <p className="text-xs text-ink-500 sm:col-span-2">
            목록에는 뒤 4자리만 보입니다. CVC는 저장하지 않습니다.
          </p>
        ) : null}
      </form>
    </Modal>
  )
}

function SnapshotModal({ accounts, latest, onClose, onSaved, userId }) {
  const toast = useToast()
  const [date, setDate] = useState(() => todayISO())
  const [memo, setMemo] = useState('')
  const [amounts, setAmounts] = useState(() => ({ ...(latest?.balances || {}) }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const total = accounts.reduce((a, c) => a + (Number(amounts[c.id]) || 0), 0)

  const submit = async (e) => {
    e.preventDefault()
    if (!date) {
      setError('날짜를 선택해 주세요.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const balances = {}
      for (const c of accounts) balances[c.id] = Math.round(Number(amounts[c.id]) || 0)
      await upsertSnapshot(date, balances, memo.trim(), userId)
      toast.success(`${date} 잔고 ${formatKRW(total)}원이 기록되었습니다.`)
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
      onClose={saving ? undefined : onClose}
      title="잔고 기록"
      subtitle="은행에서 확인한 오늘 잔고를 적습니다. 같은 날짜는 덮어씁니다."
      size="lg"
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="submit" form="snapshot-form" className="btn-primary" disabled={saving}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </>
      }
    >
      <form id="snapshot-form" onSubmit={submit} className="flex flex-col gap-4">
        {error ? <p className="text-sm font-medium text-loss">{error}</p> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="기준일">
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="메모">
            <input
              className="input"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="예: 9월 말 기준"
            />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          {accounts.map((c) => (
            <label key={c.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-semibold text-ink-700">
                {c.bank} {c.acct_no} <span className="font-normal text-ink-400">{c.product}</span>
              </span>
              <input
                type="number"
                className="input w-36 py-1 text-right text-xs"
                value={amounts[c.id] ?? ''}
                onChange={(e) => setAmounts((v) => ({ ...v, [c.id]: e.target.value }))}
                placeholder="0"
              />
            </label>
          ))}
        </div>
        <p className="text-right text-sm font-bold text-ink-900">합계 {formatKRW(total)}원</p>
      </form>
    </Modal>
  )
}

/* 계좌 거래내역 (통장 원본 그대로) */
function AccountTxModal({ acct, rows, onClose }) {
  const dep = (rows || []).reduce((a, r) => a + Number(r.deposit || 0), 0)
  const wd = (rows || []).reduce((a, r) => a + Number(r.withdrawal || 0), 0)
  return (
    <Modal
      open
      onClose={onClose}
      title={`${acct?.bank || ''} ${acct?.acct_no || ''}`}
      subtitle={`${acct?.product || ''} · 통장 거래내역 (최신 500건)`}
      size="lg"
      footer={
        <button type="button" className="btn-ghost" onClick={onClose}>
          닫기
        </button>
      }
    >
      {!rows ? (
        <LoadingBlock />
      ) : rows.length ? (
        <>
          <p className="mb-2 text-xs text-ink-500">
            입금 <strong className="font-num tabular-nums text-emerald-700">{formatKRW(dep)}원</strong>
            {' · '}출금 <strong className="font-num tabular-nums text-ink-900">{formatKRW(wd)}원</strong>
          </p>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead className="sticky top-0 bg-ink-50">
                <tr>
                  <th className="th">일시</th>
                  <th className="th">구분</th>
                  <th className="th">내용</th>
                  <th className="th text-right">입금</th>
                  <th className="th text-right">출금</th>
                  <th className="th text-right">잔고</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="td whitespace-nowrap text-ink-500">{String(r.transacted_at || '').slice(0, 16)}</td>
                    <td className="td whitespace-nowrap">{r.trans_type || '—'}</td>
                    <td className="td max-w-[220px] truncate" title={`${r.counterparty || ''}${r.memo ? ` · ${r.memo}` : ''}`}>
                      {r.counterparty || '—'}
                    </td>
                    <td className="td num text-emerald-700">{Number(r.deposit || 0) ? formatKRW(r.deposit) : '—'}</td>
                    <td className="td num">{Number(r.withdrawal || 0) ? formatKRW(r.withdrawal) : '—'}</td>
                    <td className="td num font-semibold">{formatKRW(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-400">장부(회계 정리)와 다를 수 있습니다. 통장 그대로의 기록입니다.</p>
        </>
      ) : (
        <EmptyState icon="coins" title="거래내역이 없습니다" description="이 계좌의 통장 파일을 올리면 표시됩니다." />
      )}
    </Modal>
  )
}

/* 홈택스: 부가세 신고 단위별 장부 예상액 + 납부 대조 (2026년) */
const FILED_VAT = {
  q1: { label: '신고확정 5,739,484원 (4/20 신고)', paid: 5739480, paidOn: '2026-04-23' },
  h1: { label: '신고확정 10,490,815원 (7/20 신고)', paid: 10490810, paidOn: '2026-07-22' },
}

function HometaxPanel() {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    listEntries({ from: '2026-01-01', to: '2026-12-31', maxRows: 20000 })
      .then((r) => {
        if (alive) setRows(r || [])
      })
      .catch((e) => toast.error(e.message))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [toast])

  const est = useMemo(() => vatEstimateByFiling(rows, 2026), [rows])
  const paid = useMemo(
    () =>
      (rows || []).filter(
        (e) => e.category === '세금과공과' && /부가세.*납부/.test(`${e.description || ''} ${e.memo || ''}`),
      ),
    [rows],
  )
  const paidFor = (key) => {
    const re = key === 'q1' ? /예정/ : key === 'h1' ? /확정/ : null
    if (!re) return []
    return paid.filter((e) => re.test(`${e.description || ''} ${e.memo || ''}`))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card overflow-hidden">
        <header className="border-b border-ink-200 px-4 py-3.5">
          <h2 className="text-sm font-bold text-ink-900">부가세 신고 대조 (2026년)</h2>
          <p className="mt-0.5 text-xs text-ink-500">장부 집계 vs 신고·납부. 예정은 중간예납이라 확정 때 정산됩니다.</p>
        </header>
        {loading ? (
          <LoadingBlock />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-xs">
              <thead className="bg-ink-50/70">
                <tr>
                  <th className="th">구분</th>
                  <th className="th text-right">매출세액</th>
                  <th className="th text-right">매입세액</th>
                  <th className="th text-right">납부예상(장부)</th>
                  <th className="th text-right">신고·납부</th>
                  <th className="th text-right">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {est.map((r) => {
                  const filed = FILED_VAT[r.key]
                  const pays = paidFor(r.key)
                  const paidSum = pays.reduce((a, e) => a + Number(e.total_amount || 0), 0)
                  const done = filed ? Math.abs(paidSum - filed.paid) < 100 : false
                  return (
                    <tr key={r.key}>
                      <td className="td font-medium text-ink-900">
                        {r.label}
                        <span className="block text-[11px] font-normal text-ink-400">납부기한 {r.due}</span>
                      </td>
                      <td className="td num">{formatKRW(r.saleVat)}</td>
                      <td className="td num">{formatKRW(r.buyVat)}</td>
                      <td className="td num font-bold">{formatKRW(r.net)}</td>
                      <td className="td num text-ink-500">
                        {filed ? (
                          <>
                            {formatKRW(filed.paid)}
                            <span className="block text-[11px] font-normal text-ink-400">{filed.label}</span>
                          </>
                        ) : (
                          <span className="text-ink-300">미신고</span>
                        )}
                      </td>
                      <td className="td num">
                        {filed ? (
                          done ? (
                            <span className="chip bg-emerald-50 text-emerald-700">납부완료</span>
                          ) : (
                            <span className="chip bg-amber-50 text-amber-700">
                              {paidSum ? `차액 ${formatKRW(paidSum - filed.paid)}` : '미납'}
                            </span>
                          )
                        ) : (
                          <span className="text-ink-300">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs leading-relaxed text-ink-500">
        금액은 장부 부가세 합계 기준이며, 카드·면세·간이 등은 신고서와 다를 수 있습니다. 확정 신고는 세무서 자료로 최종 확인하세요.
      </p>
    </div>
  )
}

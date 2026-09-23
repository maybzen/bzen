import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '../components/Icon'
import PartnerFormModal from '../components/PartnerFormModal'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, InlineAlert, LoadingBlock, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { downloadTextFile, toCSV } from '../lib/csv'
import {
  deletePartner,
  listPartnerDocs,
  listPartners,
  partnersTableExists,
} from '../lib/api'

/**
 * 거래처 대장 (구글시트 스타일).
 * 등록된 협력사만 보여줍니다. 장부 집계는 하지 않습니다.
 * - 마스터 등록·수정·서류 관리는 관리자만, 조회·미리보기는 권한이 있는 직원도 가능합니다.
 */
function memoLines(memo, prefix) {
  return String(memo || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => (prefix ? s.startsWith(prefix) : true))
}

function memoBizNo(memo) {
  const hit = memoLines(memo).find((s) => /\d{3}-\d{2}-\d{5}/.test(s))
  if (!hit) return ''
  const m = hit.match(/\d{3}-\d{2}-\d{5}/)
  return m ? m[0] : hit.replace(/^사업자번호:\s*/, '')
}

function memoAccounts(memo) {
  return memoLines(memo)
    .filter((s) => /계좌/.test(s))
    .map((s) => s.replace(/^계좌:\s*/, ''))
}

export default function Partners() {
  const { isAdmin, user } = useAuth()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [partners, setPartners] = useState([])
  const [docsByPartner, setDocsByPartner] = useState({})
  const [tableState, setTableState] = useState('checking')
  const [search, setSearch] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const table = await partnersTableExists().catch(() => ({ available: false, missing: true }))
      if (table.available) {
        setTableState('ready')
        const master = await listPartners()
        setPartners(master || [])
        const ids = (master || []).map((p) => p.id)
        if (ids.length) {
          const docs = await listPartnerDocs(ids).catch(() => [])
          const map = {}
          for (const d of docs || []) {
            if (!map[d.partner_id]) map[d.partner_id] = []
            map[d.partner_id].push(d)
          }
          setDocsByPartner(map)
        } else {
          setDocsByPartner({})
        }
      } else {
        setTableState('missing')
        setPartners([])
        setDocsByPartner({})
      }
    } catch (error) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return partners
    return partners.filter((p) =>
      [p.name, p.contact_person, p.job_title, p.phone_main, p.phone, p.email, p.memo].some((v) =>
        String(v || '').toLowerCase().includes(q),
      ),
    )
  }, [partners, search])

  const docTotal = useMemo(
    () => Object.values(docsByPartner).reduce((a, list) => a + list.length, 0),
    [docsByPartner],
  )

  const handleDelete = async () => {
    if (!removing) return
    setBusy(true)
    try {
      await deletePartner(removing)
      toast.success('거래처가 삭제되었습니다.')
      setRemoving(null)
      setReloadKey((k) => k + 1)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusy(false)
    }
  }

  const openNew = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const exportCSV = () => {
    if (!rows.length) {
      toast.info('내보낼 거래처가 없습니다.')
      return
    }
    const headers = ['거래처명', '담당자', '직함', '대표번호', '휴대폰', '이메일', '사업자번호', '계좌', '메모']
    const body = rows.map((p) => [
      p.name,
      p.contact_person,
      p.job_title,
      p.phone_main,
      p.phone,
      p.email,
      memoBizNo(p.memo),
      memoAccounts(p.memo).join(' / '),
      p.memo,
    ])
    downloadTextFile(`거래처대장_${new Date().toISOString().slice(0, 10)}.csv`, toCSV(headers, body))
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="거래처" description="협력사 대장입니다. 구글시트처럼 한 행에 정보가 다 보입니다.">
        <button type="button" className="btn-ghost" onClick={exportCSV}>
          <Icon name="download" size={16} />
          CSV 내보내기
        </button>
        {isAdmin && tableState === 'ready' ? (
          <button type="button" className="btn-primary" onClick={openNew}>
            <Icon name="plus" size={16} />
            거래처 등록
          </button>
        ) : null}
      </PageHeader>

      {isAdmin && tableState === 'missing' ? (
        <InlineAlert tone="warning">
          거래처 등록·서류 기능을 쓰려면 Supabase 대시보드 → SQL Editor에서 저장소의
          <strong> supabase/migration_partners.sql </strong>
          파일을 실행해 주세요.
        </InlineAlert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="등록 거래처" value={String(partners.length)} unit="곳" tone="neutral" icon="building" />
        <StatCard label="등록 서류" value={String(docTotal)} unit="건" tone="neutral" icon="file" />
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-200 px-4 py-3.5">
          <div className="relative">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              className="input pl-9"
              placeholder="거래처명·담당자·연락처·메모 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading || tableState === 'checking' ? (
          <LoadingBlock />
        ) : rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-xs">
              <thead className="bg-ink-50/70">
                <tr>
                  <th className="th">거래처명</th>
                  <th className="th">담당자</th>
                  <th className="th">직함</th>
                  <th className="th">대표번호</th>
                  <th className="th">휴대폰</th>
                  <th className="th">이메일</th>
                  <th className="th">사업자번호</th>
                  <th className="th">계좌</th>
                  <th className="th text-right">서류</th>
                  {isAdmin ? <th className="th text-right">관리</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((p) => {
                  const docs = docsByPartner[p.id] || []
                  const bizNo = memoBizNo(p.memo)
                  const accounts = memoAccounts(p.memo)
                  const openDetail = () =>
                    isAdmin ? (setEditing(p), setFormOpen(true)) : setViewing(p)
                  return (
                    <tr key={p.id} className="transition hover:bg-ink-50/60">
                      <td className="td max-w-[200px]">
                        <button
                          type="button"
                          onClick={openDetail}
                          className="block max-w-full truncate text-left font-medium text-ink-800 hover:text-brand-700 hover:underline"
                        >
                          {p.name}
                        </button>
                      </td>
                      <td className="td whitespace-nowrap">{p.contact_person || <span className="text-ink-300">—</span>}</td>
                      <td className="td whitespace-nowrap">{p.job_title || <span className="text-ink-300">—</span>}</td>
                      <td className="td whitespace-nowrap">{p.phone_main || <span className="text-ink-300">—</span>}</td>
                      <td className="td whitespace-nowrap">{p.phone || <span className="text-ink-300">—</span>}</td>
                      <td className="td max-w-[200px] truncate">{p.email || <span className="text-ink-300">—</span>}</td>
                      <td className="td whitespace-nowrap font-num tabular-nums">{bizNo || <span className="text-ink-300">—</span>}</td>
                      <td className="td max-w-[220px] truncate" title={accounts.join('\n')}>
                        {accounts.length ? accounts.join(' / ') : <span className="text-ink-300">—</span>}
                      </td>
                      <td className="td num">
                        {docs.length ? (
                          <button
                            type="button"
                            onClick={openDetail}
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-50"
                          >
                            <Icon name="paperclip" size={14} />
                            {docs.length}
                          </button>
                        ) : (
                          <span className="text-xs text-ink-300">—</span>
                        )}
                      </td>
                      {isAdmin ? (
                        <td className="td num whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(p)
                              setFormOpen(true)
                            }}
                            className="mr-2 text-xs font-semibold text-brand-700 hover:underline"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoving(p)}
                            className="text-xs font-semibold text-loss hover:underline"
                          >
                            삭제
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="building"
            title={search ? '검색 결과가 없습니다' : '등록된 거래처가 없습니다'}
            description={
              search ? '다른 단어로 검색해 보세요.' : '거래처 등록 버튼으로 협력사를 등록해 보세요.'
            }
          />
        )}
      </div>

      <PartnerFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        onSaved={() => setReloadKey((k) => k + 1)}
        initial={editing}
        userId={user?.id}
      />

      <PartnerFormModal
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        initial={viewing}
        readOnly
        userId={user?.id}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        busy={busy}
        title="거래처를 삭제하시겠습니까?"
        message={
          removing
            ? `${removing.name}\n등록된 서류도 함께 삭제됩니다. 장부 내역은 그대로 남습니다.`
            : ''
        }
        onClose={() => setRemoving(null)}
        onConfirm={handleDelete}
      />
    </div>
  )
}

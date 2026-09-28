import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon'
import PartnerFormModal from '../components/PartnerFormModal'
import { useToast } from '../components/Toast'
import { ConfirmDialog, EmptyState, InlineAlert, LoadingBlock, PageHeader, StatCard } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { PARTNER_GROUPS, suggestPartnerGroup } from '../lib/constants'
import { supabase } from '../lib/supabase'
import { downloadTextFile, toCSV } from '../lib/csv'
import { formatKRW, normalizeVendorName } from '../lib/format'
import {
  deletePartner,
  listCollections,
  listEntries,
  listPartnerDocs,
  listPartners,
  listProfiles,
  partnersTableExists,
  updatePartner,
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
  const [collections, setCollections] = useState([])
  const [profiles, setProfiles] = useState([])
  /* 거래처 모달의 거래내역용 (모달 열 때 1회 로드) */
  const [ledger, setLedger] = useState(null)
  const profileName = (id) => {
    if (!id) return ''
    const p = profiles.find((x) => x.id === id)
    return p?.full_name || p?.email || ''
  }
  const [tableState, setTableState] = useState('checking')
  const [searchParams] = useSearchParams()
  const [search, setSearch] = useState(() => searchParams.get('search') || '')
  const [groupFilter, setGroupFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortKey, setSortKey] = useState('name')
  const [reloadKey, setReloadKey] = useState(0)

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [busy, setBusy] = useState(false)
  const [customGroupId, setCustomGroupId] = useState(null)
  const [customGroupValue, setCustomGroupValue] = useState('')
  const [pendingGroups, setPendingGroups] = useState(() => {
    /* 새로고침·재로그인해도 담아둔 목록이 날아가지 않도록 브라우저에 보관 */
    try {
      const raw = localStorage.getItem('bzen.pendingGroups.v1')
      const parsed = raw ? JSON.parse(raw) : {}
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  })
  const [savingAll, setSavingAll] = useState(false)
  const pendingCount = Object.keys(pendingGroups).length

  /* 구분 변경은 바로 저장하지 않고 모아뒀다가 일괄 저장합니다 */
  const stageGroup = (partner, value) => {
    const next = String(value || '').trim() || '기타'
    setCustomGroupId(null)
    setPendingGroups((prev) => {
      if (next === (partner.group_name || '기타')) {
        if (!(partner.id in prev)) return prev
        const n = { ...prev }
        delete n[partner.id]
        return n
      }
      return { ...prev, [partner.id]: next }
    })
  }

  useEffect(() => {
    try {
      localStorage.setItem('bzen.pendingGroups.v1', JSON.stringify(pendingGroups))
    } catch {
      /* 저장 실패 무시 */
    }
  }, [pendingGroups])

  const saveAllGroups = async () => {
    const ids = Object.keys(pendingGroups)
    if (!ids.length) return
    /* 세션 만료면 서버가 전부를 거부하므로 먼저 확인 */
    const {
      data: { session: current },
    } = await supabase.auth.getSession()
    if (!current) {
      toast.error('로그인이 만료되었습니다. 다시 로그인해 주세요. (담아둔 목록은 유지됩니다)')
      return
    }
    setSavingAll(true)
    const ok = []
    const fail = []
    for (const id of ids) {
      try {
        const saved = await updatePartner(id, { group_name: pendingGroups[id] })
        setPartners((list) => list.map((p) => (p.id === id ? { ...p, ...saved } : p)))
        ok.push(id)
      } catch (e) {
        fail.push({ id, name: partners.find((p) => p.id === id)?.name || id, message: e.message })
      }
    }
    setPendingGroups((prev) => {
      const n = { ...prev }
      for (const id of ok) delete n[id]
      return n
    })
    setSavingAll(false)
    if (fail.length) {
      const names = fail.slice(0, 3).map((f) => f.name).join(', ')
      const loginHint =
        ok.length === 0 ? ' 로그아웃 후 다시 로그인해 보세요.' : ''
      toast.error(`${fail.length}건 실패(${names}${fail.length > 3 ? ' 외' : ''}): ${fail[0].message}.${loginHint}`)
    } else {
      toast.success(`${ok.length}건의 구분을 저장했습니다.`)
    }
  }

  const resetPending = () => {
    setPendingGroups({})
    setCustomGroupId(null)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const table = await partnersTableExists().catch(() => ({ available: false, missing: true }))
      if (table.available) {
        setTableState('ready')
        const master = await listPartners()
        setPartners(master || [])
        /* 목록에 없는 id가 담겨 있으면 정리 */
        const alive = new Set((master || []).map((p) => p.id))
        setPendingGroups((prev) => {
          const keys = Object.keys(prev).filter((id) => alive.has(id))
          if (keys.length === Object.keys(prev).length) return prev
          const n = {}
          for (const id of keys) n[id] = prev[id]
          return n
        })
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
        /* 수금관리 역링크용. 수금 테이블/권한이 없으면 조용히 비워 둡니다. */
        setCollections(await listCollections().catch(() => []))
        /* 등록자 표기용 */
        setProfiles(await listProfiles().catch(() => []))
      } else {
        setTableState('missing')
        setPartners([])
        setDocsByPartner({})
        setCollections([])
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

  /* 거래처 상세·수정을 열 때 거래내역을 함께 가져옵니다 (수금 잔금 확인용) */
  useEffect(() => {
    if (!formOpen) return
    let alive = true
    Promise.all([listEntries({ maxRows: 20000 }), listCollections().catch(() => [])])
      .then(([entryRows, collectionRows]) => {
        if (alive) setLedger({ entries: entryRows || [], collections: collectionRows || [] })
      })
      .catch(() => {
        if (alive) setLedger({ entries: [], collections: [] })
      })
    return () => {
      alive = false
    }
  }, [formOpen])

  const groupOptions = useMemo(() => {
    const custom = [...new Set(partners.map((p) => p.group_name).filter((g) => g && !PARTNER_GROUPS.includes(g)))]
    return [...PARTNER_GROUPS, ...custom.sort()]
  }, [partners])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = partners.filter((p) => {
      const st = p.status || '정상'
      if (statusFilter === 'active' && st === '폐업') return false
      if (statusFilter === 'closed' && st !== '폐업') return false
      if (groupFilter && (p.group_name || '기타') !== groupFilter) return false
      if (!q) return true
      return [p.name, p.group_name, p.contact_person, p.job_title, p.phone_main, p.phone, p.email, p.memo].some((v) =>
        String(v || '').toLowerCase().includes(q),
      )
    })
    const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ko')
    if (sortKey === 'group') {
      return filtered.slice().sort((a, b) => {
        const g = String(a.group_name || '기타').localeCompare(String(b.group_name || '기타'), 'ko')
        return g !== 0 ? g : byName(a, b)
      })
    }
    if (sortKey === 'recent') {
      return filtered.slice().sort((a, b) => String(b.created_at || '') < String(a.created_at || '') ? -1 : 1)
    }
    return filtered.slice().sort(byName)
  }, [partners, search, groupFilter, statusFilter, sortKey])

  const docTotal = useMemo(
    () => Object.values(docsByPartner).reduce((a, list) => a + list.length, 0),
    [docsByPartner],
  )

  /* 수금관리에 입금이 등록된 거래처만 골라 냅니다(법인격 표기 차이는 무시). */
  const collectionStats = useMemo(() => {
    const map = new Map()
    for (const c of collections) {
      const key = normalizeVendorName(c.counterparty)
      if (!key) continue
      const hit = map.get(key) || { count: 0, amount: 0 }
      hit.count += 1
      hit.amount += Number(c.amount || 0)
      map.set(key, hit)
    }
    return map
  }, [collections])

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
    const headers = ['구분', '거래처명', '영업상태', '담당자', '직함', '대표번호', '휴대폰', '이메일', '사업자번호', '계좌', '메모']
    const body = rows.map((p) => [
      p.group_name || '기타',
      p.name,
      p.status || '정상',
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
        {pendingCount > 0 ? (
          <>
            <button type="button" className="btn-ghost" onClick={resetPending} disabled={savingAll}>
              되돌리기
            </button>
            <button type="button" className="btn-primary" onClick={saveAllGroups} disabled={savingAll}>
              <Icon name="check" size={16} />
              {savingAll ? '저장 중…' : `일괄 저장 ${pendingCount}건`}
            </button>
          </>
        ) : null}
        {tableState === 'ready' ? (
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
        <StatCard
          label="수금 연동"
          value={String(collectionStats.size)}
          unit="곳"
          tone="profit"
          icon="card"
          hint="수금관리 입금 건 있음"
        />
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-ink-200 px-4 py-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
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
            <select
              className="input sm:w-52"
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
            >
              <option value="">전체 구분</option>
              {groupOptions.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <select className="input sm:w-40" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
              <option value="name">가나다순</option>
              <option value="group">구분별</option>
              <option value="recent">최근등록순</option>
            </select>
            <select className="input sm:w-36" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="active">정상만</option>
              <option value="all">전체(폐업 포함)</option>
              <option value="closed">폐업만</option>
            </select>
          </div>
        </div>

        {loading || tableState === 'checking' ? (
          <LoadingBlock />
        ) : rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-xs">
              <thead className="bg-ink-50/70">
                <tr>
                  <th className="th">구분</th>
                  <th className="th">거래처명</th>
                  <th className="th">담당자</th>
                  <th className="th">직함</th>
                  <th className="th">대표번호</th>
                  <th className="th">휴대폰</th>
                  <th className="th">이메일</th>
                  <th className="th">사업자번호</th>
                  <th className="th">계좌</th>
                  <th className="th text-right">서류</th>
                  <th className="th text-right">수금</th>
                  <th className="th">등록자</th>
                  <th className="th text-right">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((p) => {
                  const docs = docsByPartner[p.id] || []
                  const bizNo = memoBizNo(p.memo)
                  const accounts = memoAccounts(p.memo)
                  const closed = (p.status || '정상') === '폐업'
                  const effGroup = pendingGroups[p.id] ?? p.group_name
                  const groupSuggest =
                    !effGroup || effGroup === '기타'
                      ? suggestPartnerGroup(p.name, p.memo)
                      : null
                  /* 직원도 수정 가능 (삭제·서류관리는 관리자). 상세 보기는 수정 화면으로 통합 */
                  const openDetail = () => {
                    setEditing(p)
                    setFormOpen(true)
                  }
                  /* 수금관리에 입금이 남은 거래처만 수금 버튼을 노출합니다. */
                  const collected = collectionStats.get(normalizeVendorName(p.name))
                  return (
                    <tr key={p.id} className={`transition hover:bg-ink-50/60 ${closed ? 'opacity-60' : ''}`}>
                      <td className={`td whitespace-nowrap ${pendingGroups[p.id] ? 'bg-amber-50/60' : ''}`}>
                        {customGroupId === p.id ? (
                            <span className="flex items-center gap-1">
                              <input
                                autoFocus
                                className="input w-32 py-1 text-xs"
                                value={customGroupValue}
                                onChange={(e) => setCustomGroupValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') stageGroup(p, customGroupValue)
                                  if (e.key === 'Escape') setCustomGroupId(null)
                                }}
                                placeholder="직접 입력"
                              />
                              <button
                                type="button"
                                onClick={() => stageGroup(p, customGroupValue)}
                                className="text-xs font-bold text-brand-700 hover:underline"
                              >
                                담기
                              </button>
                            </span>
                          ) : (
                            <select
                              className="input w-auto py-1 text-xs"
                              value={PARTNER_GROUPS.includes(effGroup) ? effGroup : effGroup ? '__current' : '기타'}
                              onChange={(e) => {
                                const v = e.target.value
                                if (v === '__new') {
                                  setCustomGroupId(p.id)
                                  setCustomGroupValue(
                                    PARTNER_GROUPS.includes(effGroup) ? '' : effGroup || '',
                                  )
                                } else if (v !== '__current') {
                                  stageGroup(p, v)
                                }
                              }}
                            >
                              {PARTNER_GROUPS.map((g) => (
                                <option key={g} value={g}>
                                  {g}
                                </option>
                              ))}
                              {!PARTNER_GROUPS.includes(effGroup) && effGroup ? (
                                <option value="__current">{effGroup}</option>
                              ) : null}
                              <option value="__new">직접 입력…</option>
                            </select>
                          )}
                        {pendingGroups[p.id] ? (
                          <span className="mt-1 block text-[11px] font-semibold text-amber-700">
                            저장 대기 중
                          </span>
                        ) : null}
                        {groupSuggest && groupSuggest !== '기타' ? (
                          <span className="mt-1 block text-[11px] text-ink-500">
                            추천: <strong className="text-ink-700">{groupSuggest}</strong>{' '}
                            <button
                              type="button"
                              className="font-bold text-brand-700 hover:underline"
                              onClick={() => stageGroup(p, groupSuggest)}
                            >
                              담기
                            </button>
                          </span>
                        ) : null}
                      </td>
                      <td className="td max-w-[200px]">
                        <button
                          type="button"
                          onClick={openDetail}
                          className="block max-w-full truncate text-left font-medium text-ink-800 hover:text-brand-700 hover:underline"
                        >
                          {p.name}
                        </button>
                        {closed ? (
                          <span className="chip mt-1 bg-ink-100 text-ink-500">폐업</span>
                        ) : null}
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
                      <td className="td num whitespace-nowrap">
                        {collected ? (
                          <Link
                            to={`/collections?vendor=${encodeURIComponent(p.name)}`}
                            title={`수금관리에서 ${p.name} 보기 (${collected.count}건 · ${formatKRW(collected.amount)}원)`}
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50"
                          >
                            <Icon name="card" size={14} />
                            {collected.count}
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-300">—</span>
                        )}
                      </td>
                      <td className="td max-w-[110px] truncate text-xs text-ink-500">
                        {profileName(p.created_by) || <span className="text-ink-300">—</span>}
                      </td>
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
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => setRemoving(p)}
                            className="text-xs font-semibold text-loss hover:underline"
                          >
                            삭제
                          </button>
                        ) : null}
                      </td>
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
        ledger={ledger}
        isAdmin={isAdmin}
        profiles={profiles}
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

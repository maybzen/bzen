import Icon from './Icon'
import { AttachmentCell } from './Attachments'
import { ENTRY_META } from '../lib/constants'
import { formatDateHuman, formatKRW } from '../lib/format'

function personName(profiles, id) {
  if (!id) return '—'
  const p = profiles.find((x) => x.id === id)
  return p?.full_name || p?.email || '—'
}

/** 담당자 표기: 결의자 → 퇴사자 코드(메모의 N지결 등) → 기존 방식 순 */
function ownerLabel(profiles, entry) {
  if (entry.requester_id) return personName(profiles, entry.requester_id)
  if (entry.source === 'expense_report') {
    const m = String(entry.memo || '').match(/([A-Z]+)\s*지결/)
    if (m) return `퇴사자(${m[1]})`
    return '미지정'
  }
  return personName(profiles, entry.created_by)
}

export default function EntryTable({
  entries = [],
  projects = [],
  profiles = [],
  attachmentsByEntry = {},
  showType = false,
  canEdit = true,
  onEdit,
  onDelete,
  onOpenAttachments,
  emptyAction,
}) {
  if (!entries.length) {
    return (
      <div className="empty">
        <p className="font-semibold text-ink-600">내역이 없습니다</p>
        <p className="mt-1 text-xs text-ink-400">조건을 바꾸거나 새 내역을 등록해 보세요.</p>
        {emptyAction ? <div className="mt-4">{emptyAction}</div> : null}
      </div>
    )
  }

  const totals = entries.reduce(
    (acc, e) => {
      acc.supply += Number(e.supply_amount || 0)
      acc.vat += Number(e.vat_amount || 0)
      acc.total += Number(e.total_amount || 0)
      return acc
    },
    { supply: 0, vat: 0, total: 0 },
  )

  return (
    <>
      {/* 데스크톱 표 */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[960px] border-collapse">
          <thead className="border-b border-ink-200 bg-ink-50/70">
            <tr>
              <th className="th">일자</th>
              {showType ? <th className="th">유형</th> : null}
              <th className="th">프로젝트</th>
              <th className="th">거래처 / 사용처</th>
              <th className="th">항목</th>
              <th className="th">적요</th>
              <th className="th text-right">공급가액</th>
              <th className="th text-right">부가세</th>
              <th className="th text-right">합계</th>
              <th className="th">증빙</th>
              <th className="th">담당</th>
              <th className="th text-right">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {entries.map((entry) => {
              const project = projects.find((p) => p.id === entry.project_id)
              const meta = ENTRY_META[entry.entry_type]
              const files = attachmentsByEntry[entry.id] || []
              return (
                <tr key={entry.id} className="transition hover:bg-ink-50/60">
                  <td className="td whitespace-nowrap font-medium">{formatDateHuman(entry.entry_date)}</td>
                  {showType ? (
                    <td className="td">
                      <span className={`chip ${meta?.chip || 'bg-ink-100 text-ink-600'}`}>{meta?.label}</span>
                    </td>
                  ) : null}
                  <td className="td max-w-[190px] truncate">
                    {project ? (
                      <span className="text-ink-800">{project.name}</span>
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                  </td>
                  <td className="td max-w-[190px] truncate">
                    {entry.counterparty || <span className="text-ink-300">—</span>}
                  </td>
                  <td className="td max-w-[130px] truncate">
                    {entry.category ? (
                      <span className="chip bg-ink-100 text-ink-600">{entry.category}</span>
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                  </td>
                  <td className="td max-w-[240px] truncate">
                    {entry.description || <span className="text-ink-300">—</span>}
                  </td>
                  <td className="td num">{formatKRW(entry.supply_amount)}</td>
                  <td className="td num">{formatKRW(entry.vat_amount)}</td>
                  <td className="td num font-bold text-ink-900">{formatKRW(entry.total_amount)}</td>
                  <td className="td">
                    <AttachmentCell attachments={files} onOpen={onOpenAttachments} />
                  </td>
                  <td className="td max-w-[110px] truncate text-xs text-ink-500">
                    {ownerLabel(profiles, entry)}
                  </td>
                  <td className="td">
                    {canEdit ? (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onEdit?.(entry)}
                          className="rounded-md p-1.5 text-ink-500 transition hover:bg-brand-50 hover:text-brand-700"
                          aria-label="수정"
                        >
                          <Icon name="pencil" size={15} />
                        </button>
                        {onDelete ? (
                          <button
                            type="button"
                            onClick={() => onDelete?.(entry)}
                            className="rounded-md p-1.5 text-ink-500 transition hover:bg-rose-50 hover:text-loss"
                            aria-label="삭제"
                          >
                            <Icon name="trash" size={15} />
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <span className="block text-right text-xs text-ink-300">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-ink-200 bg-ink-50/80">
            <tr>
              <td className="td font-bold" colSpan={showType ? 6 : 5}>
                합계 ({entries.length}건)
              </td>
              <td className="td num font-bold">{formatKRW(totals.supply)}</td>
              <td className="td num font-bold">{formatKRW(totals.vat)}</td>
              <td className="td num font-extrabold text-brand-700">{formatKRW(totals.total)}</td>
              <td className="td" colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 모바일 카드 */}
      <ul className="flex flex-col divide-y divide-ink-100 lg:hidden">
        {entries.map((entry) => {
          const project = projects.find((p) => p.id === entry.project_id)
          const meta = ENTRY_META[entry.entry_type]
          const files = attachmentsByEntry[entry.id] || []
          return (
            <li key={entry.id} className="px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {showType ? (
                      <span className={`chip ${meta?.chip || 'bg-ink-100 text-ink-600'}`}>{meta?.label}</span>
                    ) : null}
                    <span className="text-xs font-semibold text-ink-500">
                      {formatDateHuman(entry.entry_date)}
                    </span>
                    {entry.category ? (
                      <span className="chip bg-ink-100 text-ink-600">{entry.category}</span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 truncate text-sm font-bold text-ink-900">
                    {entry.description || entry.counterparty || '(내용 없음)'}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-500">
                    {entry.counterparty || '—'}
                    {project ? ` · ${project.name}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-num text-sm font-extrabold tabular-nums text-ink-900">
                    {formatKRW(entry.total_amount)}
                  </p>
                  <p className="text-[11px] text-ink-400">공급 {formatKRW(entry.supply_amount)}</p>
                </div>
              </div>

              <div className="mt-2.5 flex items-center justify-between">
                <AttachmentCell attachments={files} onOpen={onOpenAttachments} />
                {canEdit ? (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => onEdit?.(entry)} className="btn-ghost px-2.5 py-1.5 text-xs">
                      <Icon name="pencil" size={13} />
                      수정
                    </button>
                    {onDelete ? (
                      <button
                        type="button"
                        onClick={() => onDelete?.(entry)}
                        className="btn-ghost px-2.5 py-1.5 text-xs text-loss"
                      >
                        <Icon name="trash" size={13} />
                        삭제
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
        <li className="bg-ink-50/80 px-4 py-3">
          <div className="flex items-center justify-between text-sm font-bold text-ink-900">
            <span>합계 ({entries.length}건)</span>
            <span className="font-num tabular-nums text-brand-700">{formatKRW(totals.total)}원</span>
          </div>
        </li>
      </ul>
    </>
  )
}

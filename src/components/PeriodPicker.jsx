import { useEffect, useMemo, useState } from 'react'
import { PERIOD_PRESETS, quarterRange } from '../lib/constants'
import { getPeriodRange } from '../lib/format'
import { useLedgerIndex } from '../lib/ledgerIndex'
import { SegmentedControl } from './ui'

const ALL_KEY = 'custom'
const QUARTER_PICK_KEY = 'quarterPick'

const PRESET_KEYS = [...PERIOD_PRESETS.map((p) => p.key), ALL_KEY]

function isISODate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))
}

/** localStorage에 저장된 기간을 읽습니다. 형식이 깨졌으면 null. */
function loadStoredPeriod(storageKey) {
  if (!storageKey) return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (!saved || !PRESET_KEYS.includes(saved.preset)) return null
    const custom = {
      from: isISODate(saved?.custom?.from) ? saved.custom.from : '',
      to: isISODate(saved?.custom?.to) ? saved.custom.to : '',
    }
    return { preset: saved.preset, custom }
  } catch {
    return null
  }
}

/**
 * 기간 상태 훅.
 * range.from / range.to (문자열)을 의존성으로 쓰면 안전합니다.
 * storageKey를 넘기면 마지막에 본 기간을 localStorage에 저장하고,
 * 다음에 페이지를 열 때 그대로 복원합니다. (페이지마다 다른 키 사용)
 */
export function usePeriod(initial = 'thisMonth', storageKey = null) {
  const [preset, setPreset] = useState(
    () => loadStoredPeriod(storageKey)?.preset || initial,
  )
  const [custom, setCustom] = useState(() => {
    const stored = loadStoredPeriod(storageKey)
    if (stored && (stored.preset === ALL_KEY || (stored.custom.from && stored.custom.to))) {
      return stored.custom
    }
    const base = getPeriodRange(initial) || getPeriodRange('thisMonth')
    return { from: base.from, to: base.to }
  })

  useEffect(() => {
    if (!storageKey) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ preset, custom }))
    } catch {
      /* 저장 공간이 없어도 앱은 그대로 동작합니다. */
    }
  }, [storageKey, preset, custom])

  const range = useMemo(() => {
    if (preset === ALL_KEY) {
      return { from: custom.from, to: custom.to, label: `${custom.from} ~ ${custom.to}` }
    }
    if (preset === QUARTER_PICK_KEY) {
      // 분기 선택: custom.from/to 에 해당 분기 범위를 그대로 씁니다
      if (/^\d{4}-\d{2}-01$/.test(custom.from || '') && isISODate(custom.to)) {
        const y = Number(custom.from.slice(0, 4))
        const q = Math.floor((Number(custom.from.slice(5, 7)) - 1) / 3) + 1
        return { from: custom.from, to: custom.to, label: `${y}년 ${q}분기` }
      }
      return getPeriodRange('quarter')
    }
    return getPeriodRange(preset) || { from: '', to: '', label: '전체 기간' }
  }, [preset, custom])

  return { preset, setPreset, custom, setCustom, range }
}

export default function PeriodPicker({ period, className = '' }) {
  const { preset, setPreset, custom, setCustom, range } = period

  const options = useMemo(() => [...PERIOD_PRESETS, { key: ALL_KEY, label: '직접 선택' }], [])

  /* 분기 선택용 연도·분기 (custom.from 기준, 없으면 이번 분기) */
  const now = new Date()
  const picked = useMemo(() => {
    if (/^\d{4}-\d{2}-01$/.test(custom.from || '')) {
      return {
        year: Number(custom.from.slice(0, 4)),
        quarter: Math.floor((Number(custom.from.slice(5, 7)) - 1) / 3) + 1,
      }
    }
    return { year: now.getFullYear(), quarter: Math.floor(now.getMonth() / 3) + 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset === QUARTER_PICK_KEY ? custom.from : null])
  /* 연도는 목록으로: 자료가 있는 연도만. 아직 모르면 올해만 보여줍니다 */
  const { years: dataYears } = useLedgerIndex()
  const yearOptions = useMemo(() => {
    const list = [...new Set([...(dataYears || []), picked.year])]
      .filter((y) => Number.isFinite(Number(y)))
      .map(Number)
      .sort((a, b) => b - a)
    return (list.length ? list : [now.getFullYear()]).map((v) => ({ key: String(v), label: `${v}년` }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataYears, picked.year])
  const quarterOptions = useMemo(
    () => [1, 2, 3, 4].map((q) => ({ key: String(q), label: `${q}분기` })),
    [],
  )
  const pickQuarter = (year, quarter) => {
    const r = quarterRange(year, quarter)
    setCustom({ from: r.from, to: r.to })
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <SegmentedControl size="sm" options={options} value={preset} onChange={setPreset} />

      {preset === QUARTER_PICK_KEY ? (
        <div className="flex items-center gap-1.5">
          <select
            className="input w-auto py-1.5 text-xs"
            value={String(picked.year)}
            onChange={(e) => pickQuarter(Number(e.target.value), picked.quarter)}
            aria-label="연도 선택"
          >
            {yearOptions.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <SegmentedControl
            size="sm"
            options={quarterOptions}
            value={String(picked.quarter)}
            onChange={(v) => pickQuarter(picked.year, Number(v))}
          />
        </div>
      ) : null}

      {preset === ALL_KEY ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            className="input w-auto py-1.5 text-xs"
            value={custom.from}
            onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
          />
          <span className="text-xs text-ink-400">~</span>
          <input
            type="date"
            className="input w-auto py-1.5 text-xs"
            value={custom.to}
            onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
          />
        </div>
      ) : (
        <span className="text-xs font-medium text-ink-500">{range.label}</span>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { PERIOD_PRESETS } from '../lib/constants'
import { getPeriodRange } from '../lib/format'
import { SegmentedControl } from './ui'

const ALL_KEY = 'custom'

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
    return getPeriodRange(preset) || { from: '', to: '', label: '전체 기간' }
  }, [preset, custom])

  return { preset, setPreset, custom, setCustom, range }
}

export default function PeriodPicker({ period, allowAll = true, className = '' }) {
  const { preset, setPreset, custom, setCustom, range } = period

  const options = useMemo(() => {
    const base = PERIOD_PRESETS.filter((p) => allowAll || p.key !== 'all')
    return [...base, { key: ALL_KEY, label: '직접 선택' }]
  }, [allowAll])

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <SegmentedControl size="sm" options={options} value={preset} onChange={setPreset} />

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
        <span className="hidden text-xs font-medium text-ink-500 xl:inline">{range.label}</span>
      )}
    </div>
  )
}

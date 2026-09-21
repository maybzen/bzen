import { useMemo, useState } from 'react'
import { PERIOD_PRESETS } from '../lib/constants'
import { getPeriodRange } from '../lib/format'
import { SegmentedControl } from './ui'

const ALL_KEY = 'custom'

/**
 * 기간 상태 훅.
 * range.from / range.to (문자열)을 의존성으로 쓰면 안전합니다.
 */
export function usePeriod(initial = 'thisMonth') {
  const [preset, setPreset] = useState(initial)
  const [custom, setCustom] = useState(() => {
    const base = getPeriodRange(initial) || getPeriodRange('thisMonth')
    return { from: base.from, to: base.to }
  })

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

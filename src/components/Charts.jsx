import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCompact, formatKRW, monthLabel } from '../lib/format'

const AXIS_TICK = { fontSize: 11, fill: '#6b7688' }
const LEGEND_STYLE = { fontSize: 12, paddingTop: 8 }

function MoneyTooltip({ active, payload, label, labelFormatter }) {
  if (!active || !payload || !payload.length) return null
  const heading = labelFormatter ? labelFormatter(label) : label
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2.5 shadow-pop">
      {heading ? <p className="mb-1.5 text-xs font-bold text-ink-800">{heading}</p> : null}
      {payload.map((item) => (
        <div key={item.dataKey ?? item.name} className="flex items-center justify-between gap-5 py-0.5">
          <span className="flex items-center gap-1.5 text-xs text-ink-600">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: item.color || item.payload?.color || item.fill }}
            />
            {item.name}
          </span>
          <span className="font-num text-xs font-semibold tabular-nums text-ink-900">
            {formatKRW(item.value)}원
          </span>
        </div>
      ))}
    </div>
  )
}

/** 월별 매출/매입/운영비 + 영업이익 추이 */
export function MonthlyTrendChart({ data, height = 320, showProfit = true }) {
  const compact = height < 240
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e6ed" />
        <XAxis
          dataKey="month"
          tickFormatter={monthLabel}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={formatCompact}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={compact ? 44 : 54}
        />
        <Tooltip content={<MoneyTooltip labelFormatter={(v) => `${String(v).replace('-', '년 ')}월`} />} />
        {!compact ? <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={9} /> : null}
        <Bar dataKey="sale" name="매출" fill="#2148e6" radius={[4, 4, 0, 0]} maxBarSize={24} />
        <Bar dataKey="purchase" name="매입" fill="#d97706" radius={[4, 4, 0, 0]} maxBarSize={24} />
        <Bar dataKey="opex" name="운영비" fill="#e11d48" radius={[4, 4, 0, 0]} maxBarSize={24} />
        {showProfit ? (
          <Line
            type="monotone"
            dataKey="profit"
            name="영업이익"
            stroke="#0f9d58"
            strokeWidth={2.4}
            dot={{ r: 2.8, strokeWidth: 0, fill: '#0f9d58' }}
            activeDot={{ r: 4.5 }}
          />
        ) : null}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** 비용 구성 도넛 */
export function CompositionDonut({ data, height = 260 }) {
  const total = data.reduce((sum, d) => sum + Number(d.value || 0), 0)
  if (!total) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-ink-400">
        표시할 데이터가 없습니다
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="58%"
          outerRadius="82%"
          paddingAngle={2}
          stroke="#fff"
          strokeWidth={2}
        >
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Pie>
        <Tooltip content={<MoneyTooltip />} />
        <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={9} />
      </PieChart>
    </ResponsiveContainer>
  )
}

/** 프로젝트별 매출/이익 가로 막대 */
export function ProjectBarChart({ data, height = 300 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e6ed" />
        <XAxis type="number" tickFormatter={formatCompact} tick={AXIS_TICK} axisLine={false} tickLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 11, fill: '#333e52' }}
          axisLine={false}
          tickLine={false}
          width={96}
        />
        <Tooltip content={<MoneyTooltip />} />
        <Legend wrapperStyle={LEGEND_STYLE} iconType="circle" iconSize={9} />
        <Bar dataKey="sale" name="매출" fill="#2148e6" radius={[0, 4, 4, 0]} maxBarSize={14} />
        <Bar dataKey="profit" name="영업이익" fill="#0f9d58" radius={[0, 4, 4, 0]} maxBarSize={14} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** 표 안에서 쓰는 인라인 진행 막대 */
export function ProfitBar({ value, max, tone = 'profit' }) {
  const pct = max > 0 ? Math.min(100, (Math.abs(value) / max) * 100) : 0
  const color = tone === 'loss' ? 'bg-rose-400' : tone === 'sale' ? 'bg-brand-500' : 'bg-emerald-500'
  return (
    <div className="h-1.5 w-full min-w-[64px] overflow-hidden rounded-full bg-ink-100">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

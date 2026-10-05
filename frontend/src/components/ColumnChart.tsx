import { useEffect, useRef, useState } from 'react'

export interface ChartSeries {
  name: string
  color: string
}

export interface ChartPoint {
  label: string
  values: number[]
}

const HEIGHT = 200
const PAD = { top: 12, right: 8, bottom: 26, left: 32 }
const GAP = 2

function niceMax(v: number): number {
  if (v <= 4) return 4
  const pow = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow
  return 10 * pow
}

/** Rect with rounded top corners only (data-end), square at the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
}

/** Stacked column chart with hover tooltip. Always LTR (time runs left→right in both languages). */
export default function ColumnChart({
  series,
  data,
  ariaLabel,
  totalLabel,
}: {
  series: ChartSeries[]
  data: ChartPoint[]
  ariaLabel: string
  totalLabel?: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const innerW = width - PAD.left - PAD.right
  const innerH = HEIGHT - PAD.top - PAD.bottom
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0))
  const max = niceMax(Math.max(0, ...totals))
  const band = innerW / Math.max(1, data.length)
  const barW = Math.max(2, Math.min(24, band - GAP))
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH
  const labelEvery = Math.max(1, Math.ceil(data.length / 6))
  const ticks = [0, max / 2, max]

  const h = hover !== null ? data[hover] : null
  const tipX = hover !== null ? PAD.left + band * hover + band / 2 : 0

  return (
    <div ref={wrapRef} dir="ltr" className="relative w-full">
      <svg width={width} height={HEIGHT} role="img" aria-label={ariaLabel} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="#E3DCD0" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="#5B6373">
              {Number.isInteger(t) ? t.toLocaleString() : t.toFixed(1)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const x = PAD.left + band * i + (band - barW) / 2
          let acc = 0
          const segs = d.values.map((v, si) => ({ v, si })).filter((s) => s.v > 0)
          return (
            <g key={d.label} opacity={hover === null || hover === i ? 1 : 0.45}>
              {segs.map(({ v, si }, k) => {
                const y0 = y(acc)
                acc += v
                const y1 = y(acc)
                const isTop = k === segs.length - 1
                const hgt = Math.max(0, y0 - y1 - (isTop ? 0 : GAP))
                const top = isTop ? y1 : y1 + GAP
                return isTop ? (
                  <path key={si} d={topRounded(x, top, barW, hgt, 4)} fill={series[si].color} />
                ) : (
                  <rect key={si} x={x} y={top} width={barW} height={hgt} fill={series[si].color} />
                )
              })}
            </g>
          )
        })}

        {data.map((d, i) =>
          i % labelEvery === 0 || i === data.length - 1 ? (
            <text key={d.label} x={PAD.left + band * i + band / 2} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill="#5B6373">
              {d.label}
            </text>
          ) : null,
        )}

        {/* Hit targets: the whole band, taller than the bar. */}
        {data.map((d, i) => (
          <rect
            key={d.label}
            x={PAD.left + band * i}
            y={PAD.top}
            width={band}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onTouchStart={() => setHover(i)}
          />
        ))}
      </svg>

      {h && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(tipX - 70, 0), width - 150), minWidth: 140 }}
        >
          <div className="font-semibold text-gray-900 mb-1">{h.label}</div>
          {series.map((s, si) => (
            <div key={s.name} className="flex items-center justify-between gap-3 text-gray-600">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                {s.name}
              </span>
              <span className="font-medium text-gray-900 tabular-nums">{h.values[si]}</span>
            </div>
          ))}
          {series.length > 1 && totalLabel && (
            <div className="flex justify-between gap-3 mt-1 pt-1 border-t border-gray-100 text-gray-600">
              <span>{totalLabel}</span>
              <span className="font-medium text-gray-900 tabular-nums">{h.values.reduce((a, b) => a + b, 0)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

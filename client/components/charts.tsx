import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import type { WeeklyIntensityPoint } from '../../shared/metrics'
import { formatRating, formatShortDate } from '../format'

function useContainerWidth<ElementType extends HTMLElement>() {
  const containerRef = useRef<ElementType>(null)
  const [containerWidth, setContainerWidth] = useState(320)
  useEffect(() => {
    const containerElement = containerRef.current
    if (!containerElement) return
    const resizeObserver = new ResizeObserver(([observedEntry]) => {
      if (observedEntry) setContainerWidth(Math.max(240, Math.floor(observedEntry.contentRect.width)))
    })
    resizeObserver.observe(containerElement)
    return () => resizeObserver.disconnect()
  }, [])
  return { containerRef, containerWidth }
}

const CHART_HEIGHT = 200
const PLOT_MARGIN = { top: 12, right: 40, bottom: 26, left: 30 }

/** Weekly average of the strongest feeling, at the time vs after re-rating. One y-axis, 0–100. */
export function WeeklyIntensityChart({ weeklyPoints }: { weeklyPoints: WeeklyIntensityPoint[] }) {
  const { containerRef, containerWidth } = useContainerWidth<HTMLDivElement>()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)

  const plotWidth = containerWidth - PLOT_MARGIN.left - PLOT_MARGIN.right
  const plotHeight = CHART_HEIGHT - PLOT_MARGIN.top - PLOT_MARGIN.bottom
  const xForIndex = (pointIndex: number) =>
    PLOT_MARGIN.left + (weeklyPoints.length <= 1 ? plotWidth / 2 : (pointIndex / (weeklyPoints.length - 1)) * plotWidth)
  const yForValue = (intensityValue: number) => PLOT_MARGIN.top + plotHeight - (intensityValue / 100) * plotHeight

  // Break the line where a week has no value instead of drawing through the gap.
  const buildPathData = (valueOf: (point: WeeklyIntensityPoint) => number | null) => {
    let pathData = ''
    let isPenDown = false
    weeklyPoints.forEach((point, pointIndex) => {
      const pointValue = valueOf(point)
      if (pointValue === null) {
        isPenDown = false
        return
      }
      pathData += `${isPenDown ? 'L' : 'M'}${xForIndex(pointIndex).toFixed(1)},${yForValue(pointValue).toFixed(1)}`
      isPenDown = true
    })
    return pathData
  }

  const series = [
    { key: 'before', label: 'At the time', valueOf: (point: WeeklyIntensityPoint) => point.averageStartingIntensity },
    { key: 'after', label: 'After', valueOf: (point: WeeklyIntensityPoint) => point.averageEndingIntensity },
  ] as const

  const lastValueIndex = (valueOf: (point: WeeklyIntensityPoint) => number | null) => {
    for (let pointIndex = weeklyPoints.length - 1; pointIndex >= 0; pointIndex -= 1) {
      if (valueOf(weeklyPoints[pointIndex]!) !== null) return pointIndex
    }
    return -1
  }

  const tickStride = Math.max(1, Math.ceil(weeklyPoints.length / Math.max(2, Math.floor(plotWidth / 70))))

  const handlePointerMove = (event: PointerEvent<SVGRectElement>) => {
    const boundingRect = event.currentTarget.getBoundingClientRect()
    const relativeX = ((event.clientX - boundingRect.left) / boundingRect.width) * plotWidth
    const nearestIndex =
      weeklyPoints.length <= 1 ? 0 : Math.round((relativeX / plotWidth) * (weeklyPoints.length - 1))
    setHoveredIndex(Math.min(weeklyPoints.length - 1, Math.max(0, nearestIndex)))
  }

  const hoveredPoint = hoveredIndex === null ? null : weeklyPoints[hoveredIndex]!
  const tooltipStyle = hoveredIndex === null ? undefined : ({ '--tooltip-x': `${xForIndex(hoveredIndex)}px` } as CSSProperties)

  return (
    <figure className="chart">
      <div className="chart-legend">
        {series.map((seriesDefinition) => (
          <span key={seriesDefinition.key} className={`legend-item legend-${seriesDefinition.key}`}>
            <span className="legend-swatch" aria-hidden="true" />
            {seriesDefinition.label}
          </span>
        ))}
        <button type="button" className="link-button chart-table-toggle" onClick={() => setShowTable(!showTable)}>
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {showTable ? (
        <table className="chart-table">
          <thead>
            <tr>
              <th scope="col">Week of</th>
              <th scope="col">Records</th>
              <th scope="col">At the time</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {weeklyPoints.map((point) => (
              <tr key={point.weekStart.getTime()}>
                <th scope="row">{formatShortDate(point.weekStart)}</th>
                <td>{point.entryCount}</td>
                <td>{formatRating(point.averageStartingIntensity)}</td>
                <td>{formatRating(point.averageEndingIntensity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-canvas" ref={containerRef}>
          <svg
            width={containerWidth}
            height={CHART_HEIGHT}
            role="img"
            aria-label="Weekly average of your strongest feeling, at the time and after re-rating, on a 0 to 100 scale"
          >
            {[0, 50, 100].map((gridValue) => (
              <g key={gridValue}>
                <line
                  className="chart-grid"
                  x1={PLOT_MARGIN.left}
                  x2={PLOT_MARGIN.left + plotWidth}
                  y1={yForValue(gridValue)}
                  y2={yForValue(gridValue)}
                />
                <text className="chart-axis-label" x={PLOT_MARGIN.left - 8} y={yForValue(gridValue) + 4} textAnchor="end">
                  {gridValue}
                </text>
              </g>
            ))}
            {weeklyPoints.map((point, pointIndex) =>
              pointIndex % tickStride === 0 ? (
                <text
                  key={point.weekStart.getTime()}
                  className="chart-axis-label"
                  x={xForIndex(pointIndex)}
                  y={CHART_HEIGHT - 6}
                  textAnchor="middle"
                >
                  {formatShortDate(point.weekStart)}
                </text>
              ) : null,
            )}
            {hoveredIndex !== null && (
              <line
                className="chart-crosshair"
                x1={xForIndex(hoveredIndex)}
                x2={xForIndex(hoveredIndex)}
                y1={PLOT_MARGIN.top}
                y2={PLOT_MARGIN.top + plotHeight}
              />
            )}
            {series.map((seriesDefinition) => {
              const finalIndex = lastValueIndex(seriesDefinition.valueOf)
              return (
                <g key={seriesDefinition.key} className={`series series-${seriesDefinition.key}`}>
                  <path className="series-line" d={buildPathData(seriesDefinition.valueOf)} />
                  {weeklyPoints.map((point, pointIndex) => {
                    const pointValue = seriesDefinition.valueOf(point)
                    if (pointValue === null) return null
                    return (
                      <circle
                        key={pointIndex}
                        className="series-marker"
                        cx={xForIndex(pointIndex)}
                        cy={yForValue(pointValue)}
                        r={hoveredIndex === pointIndex ? 5 : 4}
                      />
                    )
                  })}
                  {finalIndex >= 0 && (
                    <text
                      className="series-end-label"
                      x={xForIndex(finalIndex) + 8}
                      y={yForValue(seriesDefinition.valueOf(weeklyPoints[finalIndex]!)!) + 4}
                    >
                      {formatRating(seriesDefinition.valueOf(weeklyPoints[finalIndex]!))}
                    </text>
                  )}
                </g>
              )
            })}
            <rect
              className="chart-hit-area"
              x={PLOT_MARGIN.left}
              y={PLOT_MARGIN.top}
              width={plotWidth}
              height={plotHeight}
              onPointerMove={handlePointerMove}
              onPointerDown={handlePointerMove}
              onPointerLeave={() => setHoveredIndex(null)}
            />
          </svg>
          {hoveredPoint && (
            <div className="chart-tooltip" style={tooltipStyle} role="status">
              <strong>Week of {formatShortDate(hoveredPoint.weekStart)}</strong>
              <span>
                {hoveredPoint.entryCount} {hoveredPoint.entryCount === 1 ? 'record' : 'records'}
              </span>
              <span className="tooltip-row tooltip-before">At the time {formatRating(hoveredPoint.averageStartingIntensity)}</span>
              <span className="tooltip-row tooltip-after">After {formatRating(hoveredPoint.averageEndingIntensity)}</span>
            </div>
          )}
        </div>
      )}
    </figure>
  )
}

export interface BarListItem {
  key: string
  label: string
  value: number
  valueText: string
}

/** Horizontal bars with the value printed: few rows, so every bar is labeled directly. */
export function BarList({ items, maximumValue, emptyText }: { items: BarListItem[]; maximumValue?: number; emptyText: string }) {
  if (items.length === 0) return <p className="chart-empty">{emptyText}</p>
  const scaleMaximum = maximumValue ?? Math.max(...items.map((item) => item.value), 1)
  return (
    <ul className="bar-list">
      {items.map((item) => (
        <li key={item.key} className="bar-list-row">
          <span className="bar-list-label">{item.label}</span>
          <span className="bar-list-track" aria-hidden="true">
            <span
              className="bar-list-fill"
              style={{ '--bar-fill': `${Math.max(0, Math.min(100, (item.value / scaleMaximum) * 100))}%` } as CSSProperties}
            />
          </span>
          <span className="bar-list-value">{item.valueText}</span>
        </li>
      ))}
    </ul>
  )
}

/** 24 columns, one per hour of the day, in local time. */
export function HourOfDayChart({ countsByHour }: { countsByHour: number[] }) {
  const { containerRef, containerWidth } = useContainerWidth<HTMLDivElement>()
  const [hoveredHour, setHoveredHour] = useState<number | null>(null)
  const chartHeight = 120
  const bottomMargin = 20
  const columnGap = 2
  const columnWidth = (containerWidth - columnGap * 23) / 24
  const maximumCount = Math.max(...countsByHour, 1)
  const hourLabel = (hour: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2026, 0, 1, hour))

  return (
    <figure className="chart">
      <div className="chart-canvas" ref={containerRef}>
        <svg width={containerWidth} height={chartHeight} role="img" aria-label="Records by hour of day">
          {countsByHour.map((hourCount, hour) => {
            const columnHeight = Math.max(hourCount === 0 ? 0 : 3, ((chartHeight - bottomMargin) * hourCount) / maximumCount)
            const columnX = hour * (columnWidth + columnGap)
            return (
              <g key={hour}>
                <rect
                  className="hour-column-hit"
                  x={columnX}
                  y={0}
                  width={columnWidth + columnGap}
                  height={chartHeight - bottomMargin}
                  onPointerEnter={() => setHoveredHour(hour)}
                  onPointerDown={() => setHoveredHour(hour)}
                  onPointerLeave={() => setHoveredHour(null)}
                />
                <rect
                  className={`hour-column${hoveredHour === hour ? ' is-hovered' : ''}`}
                  x={columnX}
                  y={chartHeight - bottomMargin - columnHeight}
                  width={columnWidth}
                  height={columnHeight}
                  rx={Math.min(3, columnWidth / 2)}
                />
                {hour % 6 === 0 && (
                  <text className="chart-axis-label" x={columnX} y={chartHeight - 4}>
                    {hourLabel(hour)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        {hoveredHour !== null && (
          <div
            className="chart-tooltip"
            role="status"
            style={{ '--tooltip-x': `${hoveredHour * (columnWidth + columnGap) + columnWidth / 2}px` } as CSSProperties}
          >
            <strong>{hourLabel(hoveredHour)}</strong>
            <span>
              {countsByHour[hoveredHour]} {countsByHour[hoveredHour] === 1 ? 'record' : 'records'}
            </span>
          </div>
        )}
      </div>
    </figure>
  )
}

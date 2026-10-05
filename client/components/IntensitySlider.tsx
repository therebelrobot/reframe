import { useId, type CSSProperties } from 'react'

interface IntensitySliderProps {
  label: string
  value: number
  onChange: (value: number) => void
  /** The earlier rating, drawn as a ghost mark on the track so the shift is visible. */
  earlierValue?: number
  tone: 'before' | 'after'
  onRemove?: () => void
}

export function IntensitySlider({ label, value, onChange, earlierValue, tone, onRemove }: IntensitySliderProps) {
  const sliderId = useId()
  const shift = earlierValue === undefined ? null : value - earlierValue
  // CSSOM custom properties are allowed under the strict CSP (only style attributes in markup are not).
  const trackStyle = {
    '--intensity-fill': `${value}%`,
    '--intensity-earlier-fraction': earlierValue === undefined ? 0 : earlierValue / 100,
  } as CSSProperties

  return (
    <div className={`intensity intensity-${tone}`} style={trackStyle}>
      <div className="intensity-header">
        <label htmlFor={sliderId} className="intensity-label">
          {label}
        </label>
        <span className="intensity-value" aria-hidden="true">
          {value}
        </span>
        {onRemove && (
          <button type="button" className="icon-button" onClick={onRemove} aria-label={`Remove ${label}`}>
            ×
          </button>
        )}
      </div>
      <div className="intensity-track">
        {earlierValue !== undefined && <span className="intensity-earlier-mark" aria-hidden="true" />}
        <input
          id={sliderId}
          type="range"
          min={0}
          max={100}
          step={5}
          value={value}
          aria-valuetext={earlierValue === undefined ? `${value} out of 100` : `${value} out of 100, was ${earlierValue}`}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
      {shift !== null && (
        <p className="intensity-shift">
          {shift === 0 ? `Same as before (${earlierValue})` : shift < 0 ? `Down ${-shift} from ${earlierValue}` : `Up ${shift} from ${earlierValue}`}
        </p>
      )}
    </div>
  )
}

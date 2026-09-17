/**
 * Timeline view: one counted activity metric over the durable histogram's
 * bounded buckets, with the running resolution and an exact per-metric total
 * table. Reads the `activitySeries` projection; the metric set and the folds
 * live in `activity-model.ts`.
 */

import { useState } from 'react'
import type { ActivityMetricId, ActivitySeriesProjection } from '@deepseek-ai/dsh-session-stats/client'
import {
  ACTIVITY_AGGREGATE_FACTORS,
  ACTIVITY_METRICS,
  ACTIVITY_METRIC_BY_ID,
  DEFAULT_ACTIVITY_METRIC,
  activityBucketCount,
  activityBuckets,
  activitySpanMs,
  activityTotal,
  formatActivityValue,
  hasActivity,
} from './activity-model.ts'
import { formatDuration } from './format.ts'
import type { ObservabilityTranslate } from './format.ts'
import { SeriesChart } from './charts/SeriesChart.tsx'
import css from './TimelinePanel.module.css'

export interface TimelinePanelProps {
  /** The projected histogram, or `undefined` when this composition serves no activity unit. */
  readonly series: ActivitySeriesProjection | undefined
  readonly t: ObservabilityTranslate
}

/**
 * Render the activity timeline.
 * @param props - the projected histogram and the bound translate seat.
 * @returns the timeline view.
 */
export function TimelinePanel({ series, t }: TimelinePanelProps): React.JSX.Element {
  const [metricId, setMetricId] = useState<ActivityMetricId>(DEFAULT_ACTIVITY_METRIC)
  const [factor, setFactor] = useState(1)

  if (series === undefined || !hasActivity(series)) {
    return (
      <section className={css.root} aria-label={t('view.timeline')}>
        <p className={css.empty}>{t('timeline.empty')}</p>
      </section>
    )
  }

  const metric = ACTIVITY_METRIC_BY_ID[metricId]
  const buckets = activityBuckets(series, metricId, factor, t)
  const format = (value: number): string => formatActivityValue(value, metric.unit, t)

  return (
    <section className={css.root} aria-label={t('view.timeline')}>
      <div className={css.controls}>
        <label className={css.control}>
          <span className={css.controlLabel}>{t('timeline.metric')}</span>
          <select
            className={css.select}
            value={metricId}
            onChange={(event) => { setMetricId(event.target.value as ActivityMetricId) }}
          >
            {ACTIVITY_METRICS.map(entry => (
              <option key={entry.id} value={entry.id}>{t(entry.label)}</option>
            ))}
          </select>
        </label>
        <label className={css.control}>
          <span className={css.controlLabel}>{t('timeline.aggregate')}</span>
          <select
            className={css.select}
            value={String(factor)}
            onChange={(event) => { setFactor(Number(event.target.value)) }}
          >
            {ACTIVITY_AGGREGATE_FACTORS.map(value => (
              <option key={value} value={String(value)}>
                {t('timeline.aggregateOption', { value: String(value) })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className={css.summary}>
        {t('timeline.summary', {
          bucket: formatDuration(series.bucketMs * factor, t),
          count: String(activityBucketCount(series, factor)),
          span: formatDuration(activitySpanMs(series, factor), t),
        })}
      </p>
      <SeriesChart
        title={t(metric.label)}
        valueLabel={t(metric.label)}
        bars={buckets}
        emptyLabel={t('timeline.empty')}
        formatValue={format}
        t={t}
      />
      <h3 className={css.title}>{t('timeline.totals')}</h3>
      <table className={css.table}>
        <thead>
          <tr>
            <th scope="col">{t('table.metric')}</th>
            <th scope="col">{t('timeline.col.total')}</th>
          </tr>
        </thead>
        <tbody>
          {ACTIVITY_METRICS.map(entry => (
            <tr key={entry.id}>
              <th scope="row">{t(entry.label)}</th>
              <td>{formatActivityValue(activityTotal(series, entry.id, factor), entry.unit, t)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
